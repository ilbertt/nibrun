import { expect, test } from 'bun:test';
import type { PublicApiClient } from '@repo/api-client/public';
import { parseEnvironmentPatch } from '#environment.ts';
import { redeploy } from '#redeploy.ts';
import type { DeployStep } from '#release.ts';

const SLUG = 'quiet-otter';
const APP_ID = 'app-1';
const ARTIFACT_ID = 'artifact-1';
const DIGEST = 'sha256:abcd';
const PORT = 8080;
const TOKEN_SET = parseEnvironmentPatch([{ name: 'TOKEN', value: 'shh' }]);

type Sent = { what: string; body?: unknown };
type HostnameRow = { hostname: string; kind: string; state: string };

const PLATFORM: HostnameRow = { hostname: `${SLUG}.nibrun.app`, kind: 'platform', state: 'active' };

function apiHolding({
  sent,
  deployments = [{ id: 'deployment-1', artifactId: ARTIFACT_ID }],
  hostnames = [PLATFORM],
  state = 'active',
}: {
  sent: Sent[];
  deployments?: Array<{ id: string; artifactId: string }>;
  hostnames?: HostnameRow[];
  state?: string;
}): PublicApiClient {
  function underApp({ appId }: { appId: string }) {
    function artifact({ artifactId }: { artifactId: string }) {
      return {
        get: () => {
          sent.push({ what: 'artifact read', body: artifactId });
          return Promise.resolve({
            data: { id: artifactId, digest: DIGEST, originalFileName: 'my-server' },
            error: null,
          });
        },
      };
    }
    return {
      patch: (body: unknown) => {
        sent.push({ what: 'app patch', body });
        return Promise.resolve({ data: { id: appId, slug: SLUG, hostnames }, error: null });
      },
      artifacts: artifact,
      deployments: {
        get: () => {
          sent.push({ what: 'deployments read' });
          return Promise.resolve({ data: { deployments }, error: null });
        },
        post: (body: unknown) => {
          sent.push({ what: 'deployment', body });
          return Promise.resolve({ data: { id: 'deployment-2' }, error: null });
        },
      },
    };
  }

  return {
    api: {
      apps: Object.assign(underApp, {
        get: () =>
          Promise.resolve({ data: { apps: [{ id: APP_ID, slug: SLUG, state }] }, error: null }),
      }),
    },
  } as unknown as PublicApiClient;
}

test('the binary the app is running is the one released again', async () => {
  const sent: Sent[] = [];

  const deployed = await redeploy({ api: apiHolding({ sent }), app: SLUG, args: ['serve'] });

  expect(sent.at(-1)).toEqual({ what: 'deployment', body: { artifactId: ARTIFACT_ID } });
  expect(deployed).toEqual({
    appId: APP_ID,
    slug: SLUG,
    deploymentId: 'deployment-2',
    url: `https://${SLUG}.nibrun.app`,
  });
});

// A deployment snapshots the app's config as it stands, so the flags a caller just typed only run
// if they were written first.
test('config is written before the deployment that snapshots it', async () => {
  const sent: Sent[] = [];

  await redeploy({
    api: apiHolding({ sent }),
    app: SLUG,
    args: ['serve'],
    port: PORT,
    environment: TOKEN_SET,
  });

  expect(sent.filter((each) => each.what === 'app patch')).toEqual([
    {
      what: 'app patch',
      body: { args: ['serve'], guestPort: PORT, environment: { TOKEN: 'shh' } },
    },
  ]);
  expect(sent.at(-1)?.what).toBe('deployment');
});

// Every field of the edit is one the caller may have said nothing about, and an app is reachable
// again only if what it was already running survives being reconfigured.
test('what the caller left out is left alone', async () => {
  const sent: Sent[] = [];

  await redeploy({ api: apiHolding({ sent }), app: SLUG, environment: TOKEN_SET });

  expect(sent.find((each) => each.what === 'app patch')?.body).toEqual({
    environment: TOKEN_SET,
  });
});

// An app configured for a release nobody made is worse than one nothing happened to.
test('an app that has never been deployed is refused before its config moves', async () => {
  const sent: Sent[] = [];

  const attempt = redeploy({
    api: apiHolding({ sent, deployments: [] }),
    app: SLUG,
    args: ['serve'],
  });

  await expect(attempt).rejects.toThrow('This app has never been deployed.');
  expect(sent.map((each) => each.what)).not.toContain('app patch');
});

// The config would be written for a release that then sits pending until the app comes back, so
// what the app runs on would have changed without anything running it.
test('a suspended app is refused before its config moves', async () => {
  const sent: Sent[] = [];

  const attempt = redeploy({
    api: apiHolding({ sent, state: 'suspended' }),
    app: SLUG,
    args: ['serve'],
  });

  await expect(attempt).rejects.toThrow(
    'App quiet-otter is suspended, so a new release would never start. Resume it first.',
  );
  expect(sent).toEqual([]);
});

test('a slug naming nothing is said to name nothing', async () => {
  const attempt = redeploy({ api: apiHolding({ sent: [] }), app: 'loud-badger', args: [] });

  await expect(attempt).rejects.toThrow('No app with slug loud-badger.');
});

test('each step is announced, the artifact among them', async () => {
  const steps: DeployStep[] = [];

  await redeploy({
    api: apiHolding({ sent: [] }),
    app: SLUG,
    args: [],
    onStep: (step) => steps.push(step),
  });

  expect(steps).toEqual([
    { kind: 'app', appId: APP_ID, slug: SLUG },
    { kind: 'artifact', artifactId: ARTIFACT_ID, digest: DIGEST },
    { kind: 'deployment', deploymentId: 'deployment-2' },
  ]);
});
