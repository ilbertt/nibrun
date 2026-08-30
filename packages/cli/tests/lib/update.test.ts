import { expect, test } from 'bun:test';
import { updateApp } from '#lib/update.ts';
import { answering, apiHolding, listedApp } from '#tests/support/api.ts';
import { HOSTNAME, SLUG } from '#tests/support/app.ts';
import { uiRecording } from '#tests/support/ui.ts';

const ARTIFACT_ID = 'artifact-1';

function apiHoldingPatchable({ patched }: { patched: unknown[] }) {
  return apiHolding({
    apps: [listedApp()],
    underApp: ({ appId }) => ({
      patch: (body: unknown) => {
        patched.push(body);
        return answering({
          id: appId,
          slug: SLUG,
          hostnames: [{ hostname: HOSTNAME, kind: 'platform', state: 'active' }],
        })();
      },
      artifacts: ({ artifactId }: { artifactId: string }) => ({
        get: answering({ id: artifactId, digest: 'sha256:abcd' }),
      }),
      deployments: Object.assign(
        ({ deploymentId }: { deploymentId: string }) => ({
          get: answering({ id: deploymentId, state: 'running' }),
        }),
        {
          get: answering({ deployments: [{ id: 'deployment-1', artifactId: ARTIFACT_ID }] }),
          post: answering({ id: 'deployment-2' }),
        },
      ),
    }),
  });
}

test('the flags that were given are the whole of what the app is asked to change', async () => {
  const patched: unknown[] = [];

  await updateApp({
    api: apiHoldingPatchable({ patched }),
    ui: uiRecording(),
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
    api: apiHoldingPatchable({ patched }),
    ui: uiRecording(),
    slug: SLUG,
    port: 8080,
  });

  expect(patched).toEqual([{ httpPort: 8080 }]);
});

// Which port an app is given is nibrun's to decide, so the flag carries a yes or a no and never a
// number — and the no has to travel, or there would be no way to give the port up.
test('asking for a public port sends the answer, and so does giving it up', async () => {
  const patched: unknown[] = [];
  const api = apiHoldingPatchable({ patched });

  await updateApp({ api, ui: uiRecording(), slug: SLUG, extraPublicPort: true });
  await updateApp({ api, ui: uiRecording(), slug: SLUG, extraPublicPort: false });

  expect(patched).toEqual([{ hasExtraPublicPort: true }, { hasExtraPublicPort: false }]);
});

test('a flag nobody passed says nothing about the port', async () => {
  const patched: unknown[] = [];

  await updateApp({
    api: apiHoldingPatchable({ patched }),
    ui: uiRecording(),
    slug: SLUG,
    port: 8080,
  });

  expect(patched).toEqual([{ httpPort: 8080 }]);
});

// The difference `--args ""` exists to make: an empty list is a binary asked to run bare, where
// no list at all is a caller who said nothing about arguments.
test('an empty list of arguments is arguments cleared', async () => {
  const patched: unknown[] = [];

  await updateApp({
    api: apiHoldingPatchable({ patched }),
    ui: uiRecording(),
    slug: SLUG,
    args: [],
  });

  expect(patched).toEqual([{ args: [] }]);
});

test('a name the shell would not accept as a variable is refused in this program own words', () => {
  const attempt = updateApp({
    api: apiHoldingPatchable({ patched: [] }),
    ui: uiRecording(),
    slug: SLUG,
    env: ['9LIVES=cat'],
  });

  return expect(attempt).rejects.toThrow('9LIVES');
});

test('the binary being run again is named, and so is where it answers', async () => {
  const ui = uiRecording();

  await updateApp({
    api: apiHoldingPatchable({ patched: [] }),
    ui,
    slug: SLUG,
    args: [],
  });

  expect(ui.said).toEqual([
    `app ${SLUG}`,
    'artifact sha256:abcd',
    expect.stringContaining(`https://${HOSTNAME}`),
  ]);
});
