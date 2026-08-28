import { expect, test } from 'bun:test';
import type { PublicApiClient } from '@repo/api-client/public';
import type { Ui } from '#lib/ui.ts';
import { updateApp } from '#lib/update.ts';

const SLUG = 'quiet-otter';
const ARTIFACT_ID = 'artifact-1';

function apiHolding({ patched }: { patched: unknown[] }): PublicApiClient {
  function underApp({ appId }: { appId: string }) {
    return {
      patch: (body: unknown) => {
        patched.push(body);
        return Promise.resolve({
          data: {
            id: appId,
            slug: SLUG,
            hostnames: [{ hostname: `${SLUG}.nibrun.app`, kind: 'platform', state: 'active' }],
          },
          error: null,
        });
      },
      artifacts: ({ artifactId }: { artifactId: string }) => ({
        get: () =>
          Promise.resolve({ data: { id: artifactId, digest: 'sha256:abcd' }, error: null }),
      }),
      deployments: Object.assign(
        ({ deploymentId }: { deploymentId: string }) => ({
          get: () => Promise.resolve({ data: { id: deploymentId, state: 'active' }, error: null }),
        }),
        {
          get: () =>
            Promise.resolve({
              data: { deployments: [{ id: 'deployment-1', artifactId: ARTIFACT_ID }] },
              error: null,
            }),
          post: () => Promise.resolve({ data: { id: 'deployment-2' }, error: null }),
        },
      ),
    };
  }

  return {
    api: {
      apps: Object.assign(underApp, {
        get: () => Promise.resolve({ data: { apps: [{ id: 'app-1', slug: SLUG }] }, error: null }),
      }),
    },
  } as unknown as PublicApiClient;
}

function uiSaying(said: string[]): Ui {
  return {
    open: () => {},
    step: (message) => said.push(message),
    done: (message) => said.push(message),
    waitingFor: ({ task }) => task(() => {}),
  };
}

test('the flags that were given are the whole of what the app is asked to change', async () => {
  const patched: unknown[] = [];

  await updateApp({
    api: apiHolding({ patched }),
    ui: uiSaying([]),
    slug: SLUG,
    env: ['TOKEN=shh'],
    unset: ['STALE'],
  });

  expect(patched).toEqual([{ environment: { TOKEN: 'shh', STALE: null } }]);
});

// Reading a bare `nib apps redeploy --env X=y` as "and start it bare" would take the app down on
// the way to setting a variable.
test('arguments nobody named are not arguments cleared', async () => {
  const patched: unknown[] = [];

  await updateApp({
    api: apiHolding({ patched }),
    ui: uiSaying([]),
    slug: SLUG,
    port: 8080,
  });

  expect(patched).toEqual([{ httpPort: 8080 }]);
});

// The difference `--args ""` exists to make: an empty list is a binary asked to run bare, where
// no list at all is a caller who said nothing about arguments.
test('an empty list of arguments is arguments cleared', async () => {
  const patched: unknown[] = [];

  await updateApp({ api: apiHolding({ patched }), ui: uiSaying([]), slug: SLUG, args: [] });

  expect(patched).toEqual([{ args: [] }]);
});

test('a name the shell would not accept as a variable is refused in this program own words', () => {
  const attempt = updateApp({
    api: apiHolding({ patched: [] }),
    ui: uiSaying([]),
    slug: SLUG,
    env: ['9LIVES=cat'],
  });

  return expect(attempt).rejects.toThrow('9LIVES');
});

test('the binary being run again is named, and so is where it answers', async () => {
  const said: string[] = [];

  await updateApp({ api: apiHolding({ patched: [] }), ui: uiSaying(said), slug: SLUG, args: [] });

  expect(said).toEqual([
    `app ${SLUG}`,
    'artifact sha256:abcd',
    expect.stringContaining(`https://${SLUG}.nibrun.app`),
  ]);
});
