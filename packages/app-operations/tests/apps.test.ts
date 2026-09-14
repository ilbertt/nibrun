import { expect, test } from 'bun:test';
import { addressedDeployment, appById, appFor, newestDeployment } from '#apps.ts';
import { answering, apiHolding as apiWith } from '#tests/support/api.ts';
import { DIGEST } from '#tests/support/app.ts';

function apiHolding({
  apps,
  deployments = [],
}: {
  apps: Array<{ id: string; name: string; state?: string }>;
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

test('an app is read by its id, which is the one thing only it has', async () => {
  const api = apiHolding({ apps: [{ id: 'app-1', name: 'Quiet Otter' }] });

  expect(await appById({ api, appId: 'app-1' })).toMatchObject({ name: 'Quiet Otter' });
});

test('an id naming nothing is the api saying so', async () => {
  const api = apiHolding({ apps: [{ id: 'app-1', name: 'Quiet Otter' }] });

  await expect(appById({ api, appId: 'app-9' })).rejects.toThrow(
    'The api answered 404: App not found.',
  );
});

test('an app asking to run is one a release can be made onto', async () => {
  const api = apiHolding({ apps: [{ id: 'app-1', name: 'Quiet Otter', state: 'active' }] });

  expect(await appFor({ api, appId: 'app-1', operation: 'release' })).toMatchObject({
    app: { id: 'app-1' },
  });
});

// The read that says whether a release can be made says what it would be a release of, so the
// caller making one is not sent back for it.
test('and it comes back with the release it is on', async () => {
  const api = apiHolding({
    apps: [{ id: 'app-1', name: 'Quiet Otter', state: 'active' }],
    deployments: [{ id: 'deployment-2', artifactId: 'artifact-2' }],
  });

  expect(await appFor({ api, appId: 'app-1', operation: 'release' })).toMatchObject({
    newest: { artifactId: 'artifact-2' },
  });
});

// Nothing would refuse the deployment — it would sit pending for as long as the app stays down —
// so the sentence has to come from here, before the binary that would have gone with it.
test('a suspended one is refused, with the way to make it deployable', async () => {
  const api = apiHolding({ apps: [{ id: 'app-1', name: 'Quiet Otter', state: 'suspended' }] });

  await expect(appFor({ api, appId: 'app-1', operation: 'release' })).rejects.toThrow(
    'App Quiet Otter is suspended, so a new release would never start. Resume it first.',
  );
});

// The api lists deployments newest first, so the head of the list is what naming none means.
test('the deployment nobody named is the newest one', async () => {
  const api = apiHolding({
    apps: [{ id: 'app-1', name: 'Quiet Otter' }],
    deployments: [{ id: 'deployment-2' }, { id: 'deployment-1' }],
  });

  expect(await newestDeployment({ api, appId: 'app-1' })).toMatchObject({ id: 'deployment-2' });
});

test('an app that has never been deployed has no newest deployment', async () => {
  const api = apiHolding({ apps: [{ id: 'app-1', name: 'Quiet Otter' }] });

  await expect(newestDeployment({ api, appId: 'app-1' })).rejects.toThrow(
    'This app has never been deployed.',
  );
});

test('addressing without a deployment id resolves to the newest one', async () => {
  const api = apiHolding({
    apps: [{ id: 'app-1', name: 'Quiet Otter' }],
    deployments: [{ id: 'deployment-2', state: 'running' }],
  });

  expect(
    await addressedDeployment({
      api,
      appId: 'app-1',
      deploymentId: undefined,
      operation: 'logs',
    }),
  ).toEqual({
    appId: 'app-1',
    deploymentId: 'deployment-2',
    name: 'Quiet Otter',
    newest: { id: 'deployment-2', state: 'running' },
    status: { kind: 'deployment', state: 'running' },
  });
});

// The app is looked up either way, because a deployment is addressed under the app that owns it.
test('a deployment named outright still comes back under its app', async () => {
  const api = apiHolding({
    apps: [{ id: 'app-1', name: 'Quiet Otter' }],
    deployments: [{ id: 'deployment-2', state: 'running' }],
  });

  expect(
    await addressedDeployment({
      api,
      appId: 'app-1',
      deploymentId: 'deployment-9',
      operation: 'logs',
    }),
  ).toMatchObject({ appId: 'app-1', deploymentId: 'deployment-9', name: 'Quiet Otter' });
});

// Which release the app is on is a different question from which one was addressed, and the one
// that says whether anything is running: naming an older deployment does not skip asking it.
test('the release the app is on comes back alongside the one addressed', async () => {
  const api = apiHolding({
    apps: [{ id: 'app-1', name: 'Quiet Otter' }],
    deployments: [{ id: 'deployment-2', state: 'failed' }, { id: 'deployment-1' }],
  });

  const addressed = await addressedDeployment({
    api,
    appId: 'app-1',
    deploymentId: 'deployment-1',
    operation: 'logs',
  });

  expect(addressed.newest).toMatchObject({ id: 'deployment-2', state: 'failed' });
});
