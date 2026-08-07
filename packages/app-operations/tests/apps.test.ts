import { expect, test } from 'bun:test';
import type { PublicApiClient } from '@repo/api-client/public';
import { addressedDeployment, appBySlug, latestDeployment } from '#apps.ts';

function apiHolding({
  apps,
  deployments = [],
}: {
  apps: Array<{ id: string; slug: string }>;
  deployments?: Array<{ id: string }>;
}): PublicApiClient {
  function underApp() {
    return {
      deployments: { get: () => Promise.resolve({ data: { deployments }, error: null }) },
    };
  }

  return {
    api: {
      apps: Object.assign(underApp, {
        get: () => Promise.resolve({ data: { apps }, error: null }),
      }),
    },
  } as unknown as PublicApiClient;
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

// The api lists deployments newest first, so the head of the list is what naming none means.
test('the deployment nobody named is the newest one', async () => {
  const api = apiHolding({
    apps: [{ id: 'app-1', slug: 'quiet-otter' }],
    deployments: [{ id: 'deployment-2' }, { id: 'deployment-1' }],
  });

  expect(await latestDeployment({ api, appId: 'app-1' })).toBe('deployment-2');
});

test('an app that has never been deployed has no newest deployment', async () => {
  const api = apiHolding({ apps: [{ id: 'app-1', slug: 'quiet-otter' }] });

  await expect(latestDeployment({ api, appId: 'app-1' })).rejects.toThrow(
    'This app has never been deployed.',
  );
});

test('addressing without a deployment id resolves to the newest one', async () => {
  const api = apiHolding({
    apps: [{ id: 'app-1', slug: 'quiet-otter' }],
    deployments: [{ id: 'deployment-2' }],
  });

  expect(await addressedDeployment({ api, slug: 'quiet-otter', deploymentId: undefined })).toEqual({
    appId: 'app-1',
    deploymentId: 'deployment-2',
    slug: 'quiet-otter',
  });
});

// The app is looked up either way, because a deployment is addressed under the app that owns it.
test('a deployment named outright still comes back under its app', async () => {
  const api = apiHolding({ apps: [{ id: 'app-1', slug: 'quiet-otter' }] });

  expect(
    await addressedDeployment({ api, slug: 'quiet-otter', deploymentId: 'deployment-9' }),
  ).toEqual({ appId: 'app-1', deploymentId: 'deployment-9', slug: 'quiet-otter' });
});
