import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setCustomBucket } from '#lib/custom-bucket.ts';
import { apiHolding } from '#tests/support/api.ts';

const appId = 'app-1';
const config = {
  endpoint: 'https://objects.example.com',
  bucket: 'my-app',
  auth: { kind: 'anonymous' },
  encryptionPassword: 'test-secret',
};
let directory: string;
let path: string;
beforeAll(async function createConfig() {
  directory = await mkdtemp(join(tmpdir(), 'nib-bucket-'));
  path = join(directory, 'bucket.json');
  await Bun.write(path, JSON.stringify(config));
});
afterAll(async function removeConfig() {
  await rm(directory, { recursive: true });
});

test('sets only the selected app’s bucket and returns its public location', async () => {
  const location = { bucket: config.bucket, prefix: 'apps/app-1' };
  const api = apiHolding({
    apps: [],
    underApp: ({ appId: target }) => ({
      patch(body: unknown) {
        expect(target).toBe(appId);
        expect(body).toEqual({ config: { volumeStorage: config } });
        return Promise.resolve({ data: { volumeStorage: location }, error: null });
      },
    }),
  });
  expect(await setCustomBucket({ api, appId, path })).toEqual(location);
});

test('shows the request instructions from a forbidden response verbatim', async () => {
  const message = 'Open a custom-bucket request for this app.';
  const api = apiHolding({
    apps: [],
    underApp: () => ({
      patch: () =>
        Promise.resolve({ data: null, error: { status: 403, value: { error: message } } }),
    }),
  });
  await expect(setCustomBucket({ api, appId, path })).rejects.toHaveProperty('message', message);
});
