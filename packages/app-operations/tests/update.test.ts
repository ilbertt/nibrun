import { expect, test } from 'bun:test';
import { answering, apiHolding } from '#tests/support/api.ts';
import { APP_ID, SLUG } from '#tests/support/app.ts';
import { updateApp } from '#update.ts';

const HTTP_BAD_REQUEST = 400;
type Sent = { appId: string; body: unknown };

function apiRecording(sent: Sent[]) {
  return apiHolding({
    underApp: ({ appId }) => ({
      get: () => {
        throw new Error('A partial update must not read and resend the current config.');
      },
      patch: (body: { name?: string }) => {
        sent.push({ appId, body });
        if (body.name === '') {
          return Promise.resolve({
            data: null,
            error: { status: HTTP_BAD_REQUEST, value: { error: 'Invalid app name.' } },
          });
        }
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

  expect(sent[0]?.body).toEqual({
    name: 'Loud Badger',
    config: {
      httpPort: 8080,
    },
  });
});

test('the API refusal of a name is reported to the caller', async () => {
  const sent: Sent[] = [];

  await expect(updateApp({ api: apiRecording(sent), appId: APP_ID, name: '' })).rejects.toThrow(
    'Invalid app name.',
  );
  expect(sent).toEqual([{ appId: APP_ID, body: { name: '' } }]);
});

test('an explicit public policy can replace JWT access without editing runtime fields', async () => {
  const sent: Sent[] = [];
  await updateApp({ api: apiRecording(sent), appId: APP_ID, access: { kind: 'public' } });
  expect(sent).toEqual([{ appId: APP_ID, body: { config: { access: { kind: 'public' } } } }]);
});
