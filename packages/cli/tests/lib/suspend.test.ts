import { expect, test } from 'bun:test';
import { resumeApp, suspendApp } from '#lib/suspend.ts';
import {
  apiHolding,
  deploymentsHolding,
  listedApp,
  RUNNING_DEPLOYMENT,
} from '#tests/support/api.ts';
import { APP_ID, SLUG } from '#tests/support/app.ts';
import { uiRecording } from '#tests/support/ui.ts';

type Asked = { appId: string; state: string };

/**
 * The listing and the write behind one client, because what these commands do with the state an
 * app is already in is the whole of what they decide: the read is not a lookup they could skip.
 */
function apiInState({
  state,
  asked,
  deployments = [RUNNING_DEPLOYMENT],
}: {
  state: string;
  asked: Asked[];
  deployments?: Array<{ id: string; state: string }>;
}) {
  return apiHolding({
    apps: [listedApp({ state })],
    underApp: ({ appId }) => ({
      deployments: deploymentsHolding(deployments),
      state: {
        put: (body: { state: string }) => {
          asked.push({ appId, state: body.state });
          return Promise.resolve({ data: { slug: SLUG, state: body.state }, error: null });
        },
      },
    }),
  });
}

test('suspending a running app asks the api for it', async () => {
  const asked: Asked[] = [];
  const ui = uiRecording();

  await suspendApp({ api: apiInState({ state: 'active', asked }), slug: SLUG, ui });

  expect(asked).toEqual([{ appId: APP_ID, state: 'suspended' }]);
  expect(ui.said[0]).toContain('is suspended');
});

// Asking twice is asking once, and the second is answered by the state the first left it in.
test('suspending one that already is says so and sends nothing', async () => {
  const asked: Asked[] = [];
  const ui = uiRecording();

  await suspendApp({ api: apiInState({ state: 'suspended', asked }), slug: SLUG, ui });

  expect(asked).toEqual([]);
  expect(ui.said).toEqual([`${SLUG} is already suspended.`]);
});

test('resuming a suspended app puts it back', async () => {
  const asked: Asked[] = [];
  const ui = uiRecording();

  await resumeApp({ api: apiInState({ state: 'suspended', asked }), slug: SLUG, ui });

  expect(asked).toEqual([{ appId: APP_ID, state: 'active' }]);
  expect(ui.said[0]).toContain('is active');
});

test('and resuming one that is already running sends nothing either', async () => {
  const asked: Asked[] = [];
  const ui = uiRecording();

  await resumeApp({ api: apiInState({ state: 'active', asked }), slug: SLUG, ui });

  expect(asked).toEqual([]);
  expect(ui.said).toEqual([`${SLUG} is already running.`]);
});

// The api refuses this too. Said here because the read that turns a slug into an id has already
// been paid for, and being told what is happening to the app beats being told it was not found.
test('an app being deleted is refused rather than sent', async () => {
  const asked: Asked[] = [];

  await expect(
    resumeApp({
      api: apiInState({ state: 'deleting', asked }),
      slug: SLUG,
      ui: uiRecording(),
    }),
  ).rejects.toThrow('App quiet-otter is being deleted, so there is nothing left to bring back.');
  expect(asked).toEqual([]);
});
