import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { sealedFromStore } from '#lib/tenant-secrets.ts';
import { registeredAccount } from '#tests/controllers/support/accounts.ts';
import { ORIGIN, sendJson } from '#tests/controllers/support/api.ts';

const { auth, AppsServicePlugin } = await import('#services/plugins.ts');
const appId = 'bucket-app';
const url = `${ORIGIN}/api/apps/${appId}/bucket-setup`;
const body = {
  endpoint: 'https://objects.example.com',
  bucket: 'owned-data',
  auth: { kind: 'anonymous' },
  encryptionPassword: 'private-password',
};

afterEach(function restoreServices() {
  mock.restore();
});

test('the dashboard prepares an uncached setup code for the signed-in owner', async () => {
  const account = await registeredAccount();
  const result = { setupCode: sealedFromStore('encrypted'), expiresAt: '2026-11-26T10:15:00.000Z' };
  const prepare = spyOn(
    AppsServicePlugin.decorator.appsService,
    'prepareBucketSetup',
  ).mockResolvedValue(result);
  const response = await sendJson({
    method: 'POST',
    url,
    body,
    headers: { cookie: account.cookie },
  });
  expect(response.status).toBe(StatusMap.OK);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual(result);
  expect(prepare).toHaveBeenCalledWith({ ownerId: account.ownerId, appId, storage: body });
});

test('an unauthenticated or anonymous client cannot prepare bucket settings', async () => {
  const prepare = spyOn(AppsServicePlugin.decorator.appsService, 'prepareBucketSetup');
  expect((await sendJson({ method: 'POST', url, body })).status).toBe(StatusMap.Unauthorized);
  const anonymous = await auth.api.signInAnonymous({ returnHeaders: true });
  const response = await sendJson({
    method: 'POST',
    url,
    body,
    headers: { authorization: `Bearer ${anonymous.response.token}` },
  });
  expect(response.status).toBe(StatusMap.Forbidden);
  expect(prepare).not.toHaveBeenCalled();
});
