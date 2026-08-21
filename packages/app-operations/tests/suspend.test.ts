import { expect, test } from 'bun:test';
import type { PublicApiClient } from '@repo/api-client/public';
import { resumeApp, suspendApp } from '#suspend.ts';

const SLUG = 'quiet-otter';

type Asked = { appId: string; state: string };

function apiRecording(asked: Asked[]): PublicApiClient {
  function addressed({ appId }: { appId: string }) {
    return {
      state: {
        put: ({ state }: { state: string }) => {
          asked.push({ appId, state });
          return Promise.resolve({ data: { slug: SLUG, state }, error: null });
        },
      },
    };
  }
  return { api: { apps: addressed } } as unknown as PublicApiClient;
}

// Neither says stop or start: the app is put in a state, and the host reads what to run off it.
test('suspending asks for the app to be suspended, and nothing else', async () => {
  const asked: Asked[] = [];

  const suspended = await suspendApp({ api: apiRecording(asked), appId: 'app-1' });

  expect(asked).toEqual([{ appId: 'app-1', state: 'suspended' }]);
  expect(suspended).toEqual({ slug: SLUG, state: 'suspended' });
});

test('and resuming asks for the state it was in before', async () => {
  const asked: Asked[] = [];

  const resumed = await resumeApp({ api: apiRecording(asked), appId: 'app-1' });

  expect(asked).toEqual([{ appId: 'app-1', state: 'active' }]);
  expect(resumed).toEqual({ slug: SLUG, state: 'active' });
});
