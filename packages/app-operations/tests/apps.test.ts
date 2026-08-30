import { expect, test } from 'bun:test';
import { addressedDeployment, appBySlug, appFor, newestDeployment } from '#apps.ts';
import { answering, apiHolding as apiWith } from '#tests/support/api.ts';
import { DIGEST } from '#tests/support/app.ts';

function apiHolding({
  apps,
  deployments = [],
}: {
  apps: Array<{ id: string; slug: string; state?: string }>;
  deployments?: Array<{ id: string; artifactId?: string; state?: string }>;
}) {
  return apiWith({
    apps,
    underApp: () => ({
      artifacts: ({ artifactId }: { artifactId: string }) => ({
        get: answering({ id: artifactId, digest: DIGEST }),
      }),
      deployments: { get: answering({ deployments }) },
    }),
  });
}

test('an app is found by the name its owner calls it', async () => {
  const api = apiHolding({ apps: [{ id: 'app-1', slug: 'quiet-otter' }] });

  expect(await appBySlug({ api, slug: 'quiet-otter' })).toMatchObject({ id: 'app-1' });
});

test('a slug naming nothing is said to name nothing', async () => {
  const api = apiHolding({ apps: [{ id: 'app-1', slug: 'quiet-otter' }] });

  await expect(appBySlug({ api, slug: 'loud-badger' })).rejects.toThrow(
    'No app with slug loud-badger.',
  );
});

test('an app asking to run is one a release can be made onto', async () => {
  const api = apiHolding({ apps: [{ id: 'app-1', slug: 'quiet-otter', state: 'active' }] });

  expect(await appFor({ api, slug: 'quiet-otter', operation: 'release' })).toMatchObject({
    app: { id: 'app-1' },
  });
});

// The read that says whether a release can be made says what it would be a release of, so the
// caller making one is not sent back for it.
test('and it comes back with the release it is on', async () => {
  const api = apiHolding({
    apps: [{ id: 'app-1', slug: 'quiet-otter', state: 'active' }],
    deployments: [{ id: 'deployment-2', artifactId: 'artifact-2' }],
  });

  expect(await appFor({ api, slug: 'quiet-otter', operation: 'release' })).toMatchObject({
    newest: { artifactId: 'artifact-2' },
  });
});

// Nothing would refuse the deployment — it would sit pending for as long as the app stays down —
// so the sentence has to come from here, before the binary that would have gone with it.
test('a suspended one is refused, with the way to make it deployable', async () => {
  const api = apiHolding({ apps: [{ id: 'app-1', slug: 'quiet-otter', state: 'suspended' }] });

  await expect(appFor({ api, slug: 'quiet-otter', operation: 'release' })).rejects.toThrow(
    'App quiet-otter is suspended, so a new release would never start. Resume it first.',
  );
});

// The api lists deployments newest first, so the head of the list is what naming none means.
test('the deployment nobody named is the newest one', async () => {
  const api = apiHolding({
    apps: [{ id: 'app-1', slug: 'quiet-otter' }],
    deployments: [{ id: 'deployment-2' }, { id: 'deployment-1' }],
  });

  expect(await newestDeployment({ api, appId: 'app-1' })).toMatchObject({ id: 'deployment-2' });
});

test('an app that has never been deployed has no newest deployment', async () => {
  const api = apiHolding({ apps: [{ id: 'app-1', slug: 'quiet-otter' }] });

  await expect(newestDeployment({ api, appId: 'app-1' })).rejects.toThrow(
    'This app has never been deployed.',
  );
});

test('addressing without a deployment id resolves to the newest one', async () => {
  const api = apiHolding({
    apps: [{ id: 'app-1', slug: 'quiet-otter' }],
    deployments: [{ id: 'deployment-2', state: 'running' }],
  });

  expect(
    await addressedDeployment({
      api,
      slug: 'quiet-otter',
      deploymentId: undefined,
      operation: 'logs',
    }),
  ).toEqual({
    appId: 'app-1',
    deploymentId: 'deployment-2',
    slug: 'quiet-otter',
    newest: { id: 'deployment-2', state: 'running' },
    status: { kind: 'deployment', state: 'running' },
  });
});

// The app is looked up either way, because a deployment is addressed under the app that owns it.
test('a deployment named outright still comes back under its app', async () => {
  const api = apiHolding({
    apps: [{ id: 'app-1', slug: 'quiet-otter' }],
    deployments: [{ id: 'deployment-2', state: 'running' }],
  });

  expect(
    await addressedDeployment({
      api,
      slug: 'quiet-otter',
      deploymentId: 'deployment-9',
      operation: 'logs',
    }),
  ).toMatchObject({ appId: 'app-1', deploymentId: 'deployment-9', slug: 'quiet-otter' });
});

// Which release the app is on is a different question from which one was addressed, and the one
// that says whether anything is running: naming an older deployment does not skip asking it.
test('the release the app is on comes back alongside the one addressed', async () => {
  const api = apiHolding({
    apps: [{ id: 'app-1', slug: 'quiet-otter' }],
    deployments: [{ id: 'deployment-2', state: 'failed' }, { id: 'deployment-1' }],
  });

  const addressed = await addressedDeployment({
    api,
    slug: 'quiet-otter',
    deploymentId: 'deployment-1',
    operation: 'logs',
  });

  expect(addressed.newest).toMatchObject({ id: 'deployment-2', state: 'failed' });
});
