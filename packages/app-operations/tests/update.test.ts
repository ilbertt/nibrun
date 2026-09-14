import { expect, test } from 'bun:test';
import { answering, apiHolding } from '#tests/support/api.ts';
import { APP_ID, SLUG } from '#tests/support/app.ts';
import { updateApp } from '#update.ts';

type Sent = { appId: string; body: unknown };

function apiRecording(sent: Sent[]) {
  return apiHolding({
    underApp: ({ appId }) => ({
      patch: (body: { name?: string }) => {
        sent.push({ appId, body });
        return answering({ id: appId, name: body.name ?? 'Quiet Otter', slug: SLUG })();
      },
      deployments: {
        post: () => {
          throw new Error('an update makes no release');
        },
      },
    }),
  });
}

test('an update is the patch and nothing after it', async () => {
  const sent: Sent[] = [];

  const updated = await updateApp({ api: apiRecording(sent), appId: APP_ID, name: 'Loud Badger' });

  expect(sent).toEqual([{ appId: APP_ID, body: { name: 'Loud Badger' } }]);
  expect(updated).toMatchObject({ id: APP_ID, name: 'Loud Badger', slug: SLUG });
});

test('config and name travel in one patch', async () => {
  const sent: Sent[] = [];

  await updateApp({ api: apiRecording(sent), appId: APP_ID, name: 'Loud Badger', port: 8080 });

  expect(sent[0]?.body).toEqual({ name: 'Loud Badger', httpPort: 8080 });
});

// The api would refuse it too, after the round trip; the whole point of parsing here is that
// nothing is sent.
test('a name the api would refuse is refused before anything is sent', async () => {
  const sent: Sent[] = [];

  await expect(updateApp({ api: apiRecording(sent), appId: APP_ID, name: '' })).rejects.toThrow();
  expect(sent).toEqual([]);
});
