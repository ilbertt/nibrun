import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { StatusMap } from 'elysia';
import { ConflictError, NotFoundError } from '#lib/errors.ts';
import { registeredAccount } from '#tests/controllers/support/accounts.ts';
import { ORIGIN, routesUnder, send } from '#tests/controllers/support/api.ts';

const { auth, VolumeStorageMigrationsServicePlugin } = await import('#services/plugins.ts');
const service = VolumeStorageMigrationsServicePlugin.decorator.volumeStorageMigrationsService;
const APP_ID = Value.Parse(AppIdSchema, 'app-1');
const URL = `${ORIGIN}/api/apps/${APP_ID}/volume-storage-migration`;
const CANCEL_URL = `${URL}?configId=destination`;

afterEach(function restoreMocks() {
  mock.restore();
});

test('only status and queued cancellation are mounted; migration creation stays unavailable', () => {
  expect(routesUnder('/api/apps/:appId/volume-storage-migration')).toEqual([
    { method: 'GET', path: '/api/apps/:appId/volume-storage-migration' },
    { method: 'DELETE', path: '/api/apps/:appId/volume-storage-migration' },
  ]);
});

test('status and cancellation require an authenticated account', async () => {
  expect((await send({ url: URL })).status).toBe(StatusMap.Unauthorized);
  expect((await send({ method: 'DELETE', url: CANCEL_URL })).status).toBe(StatusMap.Unauthorized);
  const anonymous = await auth.api.signInAnonymous({ returnHeaders: true });
  const headers = { authorization: `Bearer ${anonymous.response.token}` };
  expect((await send({ url: URL, headers })).status).toBe(StatusMap.Forbidden);
  expect((await send({ method: 'DELETE', url: CANCEL_URL, headers })).status).toBe(
    StatusMap.Forbidden,
  );
});

test('status for an app without migration configuration is null and uses the authenticated owner', async () => {
  const account = await registeredAccount();
  const get = spyOn(service, 'get').mockResolvedValue(null);
  const response = await send({ url: URL, headers: { cookie: account.cookie } });
  expect(response.status).toBe(StatusMap.OK);
  expect(await response.json()).toEqual({ migration: null });
  expect(get).toHaveBeenCalledWith({ appId: APP_ID, ownerId: account.ownerId });
  const migration = {
    configId: 'destination',
    state: 'pending' as const,
    message: null,
    canCancel: true,
  };
  get.mockResolvedValue(migration);
  const pending = await send({ url: URL, headers: { cookie: account.cookie } });
  expect(pending.status).toBe(StatusMap.OK);
  expect(await pending.json()).toEqual({ migration });
});

test('cancellation requires a config token and never accepts an owner from the query', async () => {
  const account = await registeredAccount();
  const cancel = spyOn(service, 'cancel').mockResolvedValue(undefined);
  for (const query of ['', '?configId=', '?configId=destination&ownerId=someone-else']) {
    const response = await send({
      method: 'DELETE',
      url: `${URL}${query}`,
      headers: { cookie: account.cookie },
    });
    expect(response.status).toBe(StatusMap['Bad Request']);
  }
  expect(cancel).not.toHaveBeenCalled();
  const response = await send({
    method: 'DELETE',
    url: CANCEL_URL,
    headers: { cookie: account.cookie },
  });
  expect(response.status).toBe(StatusMap['No Content']);
  expect(await response.text()).toBe('');
  expect(cancel).toHaveBeenCalledWith({
    appId: APP_ID,
    ownerId: account.ownerId,
    configId: 'destination',
  });
});

test('unowned apps and started migrations preserve not-found and conflict responses', async () => {
  const account = await registeredAccount();
  spyOn(service, 'get').mockRejectedValue(new NotFoundError());
  expect((await send({ url: URL, headers: { cookie: account.cookie } })).status).toBe(
    StatusMap['Not Found'],
  );
  spyOn(service, 'cancel').mockRejectedValue(new ConflictError());
  expect(
    (await send({ method: 'DELETE', url: CANCEL_URL, headers: { cookie: account.cookie } })).status,
  ).toBe(StatusMap.Conflict);
});
