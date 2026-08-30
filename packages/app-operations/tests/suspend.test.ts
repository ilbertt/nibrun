import { expect, test } from 'bun:test';
import { resumeApp, suspendApp } from '#suspend.ts';
import { answering, apiHolding } from '#tests/support/api.ts';
import { APP_ID, SLUG } from '#tests/support/app.ts';

type Asked = { appId: string; state: string };

function apiRecording(asked: Asked[]) {
  return apiHolding({
    underApp: ({ appId }) => ({
      state: {
        put: ({ state }: { state: string }) => {
          asked.push({ appId, state });
          return answering({ slug: SLUG, state })();
        },
      },
    }),
  });
}

// Neither says stop or start: the app is put in a state, and the host reads what to run off it.
test('suspending asks for the app to be suspended, and nothing else', async () => {
  const asked: Asked[] = [];

  const suspended = await suspendApp({ api: apiRecording(asked), appId: APP_ID });

  expect(asked).toEqual([{ appId: APP_ID, state: 'suspended' }]);
  expect(suspended).toEqual({ slug: SLUG, state: 'suspended' });
});

test('and resuming asks for the state it was in before', async () => {
  const asked: Asked[] = [];

  const resumed = await resumeApp({ api: apiRecording(asked), appId: APP_ID });

  expect(asked).toEqual([{ appId: APP_ID, state: 'active' }]);
  expect(resumed).toEqual({ slug: SLUG, state: 'active' });
});
