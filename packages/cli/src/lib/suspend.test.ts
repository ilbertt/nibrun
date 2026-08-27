import { expect, test } from 'bun:test';
import type { PublicApiClient } from '@repo/api-client/public';
import { resumeApp, suspendApp } from '#lib/suspend.ts';
import type { Ui } from '#lib/ui.ts';

const SLUG = 'quiet-otter';

type Asked = { appId: string; state: string };

/**
 * The listing and the write behind one client, because what these commands do with the state an
 * app is already in is the whole of what they decide: the read is not a lookup they could skip.
 */
function apiHolding({
  state,
  asked,
  deployments = [{ id: 'deployment-1', state: 'active' }],
}: {
  state: string;
  asked: Asked[];
  deployments?: Array<{ id: string; state: string }>;
}): PublicApiClient {
  function apps({ appId }: { appId: string }) {
    return {
      deployments: { get: () => Promise.resolve({ data: { deployments }, error: null }) },
      state: {
        put: (body: { state: string }) => {
          asked.push({ appId, state: body.state });
          return Promise.resolve({ data: { slug: SLUG, state: body.state }, error: null });
        },
      },
    };
  }
  apps.get = () =>
    Promise.resolve({ data: { apps: [{ id: 'app-1', slug: SLUG, state }] }, error: null });

  return { api: { apps } } as unknown as PublicApiClient;
}

function uiSaying(said: string[]): Ui {
  return {
    open: () => {},
    step: () => {},
    done: (message) => said.push(message),
    waitingFor: ({ task }) => task(() => {}),
  };
}

test('suspending a running app asks the api for it', async () => {
  const asked: Asked[] = [];
  const said: string[] = [];

  await suspendApp({ api: apiHolding({ state: 'active', asked }), slug: SLUG, ui: uiSaying(said) });

  expect(asked).toEqual([{ appId: 'app-1', state: 'suspended' }]);
  expect(said[0]).toContain('is suspended');
});

// Asking twice is asking once, and the second is answered by the state the first left it in.
test('suspending one that already is says so and sends nothing', async () => {
  const asked: Asked[] = [];
  const said: string[] = [];

  await suspendApp({
    api: apiHolding({ state: 'suspended', asked }),
    slug: SLUG,
    ui: uiSaying(said),
  });

  expect(asked).toEqual([]);
  expect(said).toEqual([`${SLUG} is already suspended.`]);
});

test('resuming a suspended app puts it back', async () => {
  const asked: Asked[] = [];
  const said: string[] = [];

  await resumeApp({
    api: apiHolding({ state: 'suspended', asked }),
    slug: SLUG,
    ui: uiSaying(said),
  });

  expect(asked).toEqual([{ appId: 'app-1', state: 'active' }]);
  expect(said[0]).toContain('is active');
});

test('and resuming one that is already running sends nothing either', async () => {
  const asked: Asked[] = [];
  const said: string[] = [];

  await resumeApp({ api: apiHolding({ state: 'active', asked }), slug: SLUG, ui: uiSaying(said) });

  expect(asked).toEqual([]);
  expect(said).toEqual([`${SLUG} is already running.`]);
});

// The api refuses this too. Said here because the read that turns a slug into an id has already
// been paid for, and being told what is happening to the app beats being told it was not found.
test('an app being deleted is refused rather than sent', async () => {
  const asked: Asked[] = [];

  await expect(
    resumeApp({ api: apiHolding({ state: 'deleting', asked }), slug: SLUG, ui: uiSaying([]) }),
  ).rejects.toThrow('App quiet-otter is being deleted, so there is nothing left to bring back.');
  expect(asked).toEqual([]);
});
