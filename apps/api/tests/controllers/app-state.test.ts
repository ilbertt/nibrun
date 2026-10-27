import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { StatusMap } from 'elysia';
import type { OwnerId } from '#lib/api/identifiers.ts';
import { configWithDefaults } from '#lib/app-config.ts';
import { ConflictError, NotFoundError } from '#lib/errors.ts';
import { AppResponseSchema } from '#routes/api/apps/model.ts';
import { registeredAccount } from '#tests/controllers/support/accounts.ts';
import { ORIGIN, routesUnder, sendJson } from '#tests/controllers/support/api.ts';

const { auth, AppsServicePlugin, VolumeStorageMigrationsServicePlugin } = await import(
  '#services/plugins.ts'
);
const appsService = AppsServicePlugin.decorator.appsService;
const migrationsService =
  VolumeStorageMigrationsServicePlugin.decorator.volumeStorageMigrationsService;
const APP_ID = Value.Parse(AppIdSchema, 'app-1');
const URL = `${ORIGIN}/api/apps/${APP_ID}/state`;
const CANCELLATION = { volumeStorageMigration: { configId: 'destination', state: 'cancelled' } };

function appResource(ownerId: OwnerId) {
  const timestamp = '2026-10-27T08:00:00Z';
  return Value.Parse(AppResponseSchema, {
    id: APP_ID,
    ownerId,
    name: 'test-app',
    slug: 'test-app',
    state: 'active',
    activation: 'on-request',
    idleTimeoutMs: 60_000,
    createdAt: timestamp,
    updatedAt: timestamp,
    config: { ...configWithDefaults(), environment: {} },
    hostnames: [
      {
        hostname: 'test-app.apps.test',
        kind: 'platform',
        state: 'active',
        dcvTarget: null,
        edgeErrors: [],
        createdAt: timestamp,
      },
    ],
    volumeUsage: null,
    computeUsage: null,
    expiresAt: null,
    volumeStorageMigration: {
      configId: 'restored',
      state: 'cancelled',
      message: null,
      canCancel: false,
    },
  });
}

afterEach(function restoreMocks() {
  mock.restore();
});

test('migration changes reuse the app state PUT and have no separate route', () => {
  expect(routesUnder('/api/apps/:appId/volume-storage-migration')).toEqual([]);
  expect(routesUnder('/api/apps/:appId/state')).toEqual([
    { method: 'PUT', path: '/api/apps/:appId/state' },
  ]);
});

test('migration cancellation requires a registered account', async () => {
  expect((await sendJson({ method: 'PUT', url: URL, body: CANCELLATION })).status).toBe(
    StatusMap.Unauthorized,
  );
  const anonymous = await auth.api.signInAnonymous({ returnHeaders: true });
  const headers = { authorization: `Bearer ${anonymous.response.token}` };
  expect((await sendJson({ method: 'PUT', url: URL, body: CANCELLATION, headers })).status).toBe(
    StatusMap.Forbidden,
  );
});

test('cancellation uses its config version and returns the updated app without changing its run state', async () => {
  const account = await registeredAccount();
  const app = appResource(account.ownerId);
  const cancel = spyOn(migrationsService, 'cancel').mockResolvedValue(undefined);
  const get = spyOn(appsService, 'get').mockResolvedValue(app);
  const setState = spyOn(appsService, 'setState');
  const response = await sendJson({
    method: 'PUT',
    url: URL,
    body: CANCELLATION,
    headers: { cookie: account.cookie },
  });
  expect(response.status).toBe(StatusMap.OK);
  expect(await response.json()).toEqual(app);
  expect(cancel).toHaveBeenCalledWith({
    appId: APP_ID,
    ownerId: account.ownerId,
    configId: 'destination',
  });
  expect(get).toHaveBeenCalledWith({ appId: APP_ID, ownerId: account.ownerId });
  expect(setState).not.toHaveBeenCalled();
});

test('ordinary app state changes keep their request and response behavior', async () => {
  const account = await registeredAccount();
  const app = { ...appResource(account.ownerId), state: 'suspended' as const };
  const setState = spyOn(appsService, 'setState').mockResolvedValue(app);
  const cancel = spyOn(migrationsService, 'cancel');
  const response = await sendJson({
    method: 'PUT',
    url: URL,
    body: { state: 'suspended' },
    headers: { cookie: account.cookie },
  });
  expect(response.status).toBe(StatusMap.OK);
  expect(await response.json()).toEqual(app);
  expect(setState).toHaveBeenCalledWith({
    appId: APP_ID,
    ownerId: account.ownerId,
    state: 'suspended',
  });
  expect(cancel).not.toHaveBeenCalled();
});

test('invalid, spoofed and combined state transitions are rejected before either mutation', async () => {
  const account = await registeredAccount();
  const cancel = spyOn(migrationsService, 'cancel');
  const setState = spyOn(appsService, 'setState');
  for (const body of [
    {},
    { volumeStorageMigration: { state: 'cancelled' } },
    { volumeStorageMigration: { configId: '', state: 'cancelled' } },
    { volumeStorageMigration: { configId: 'destination', state: 'completed' } },
    { ...CANCELLATION, ownerId: 'someone-else' },
    { ...CANCELLATION, state: 'suspended' },
  ]) {
    const response = await sendJson({
      method: 'PUT',
      url: URL,
      body,
      headers: { cookie: account.cookie },
    });
    expect(response.status).toBe(StatusMap['Bad Request']);
  }
  expect(cancel).not.toHaveBeenCalled();
  expect(setState).not.toHaveBeenCalled();
});

test('unowned apps and started migrations preserve not-found and conflict responses', async () => {
  const account = await registeredAccount();
  const cancel = spyOn(migrationsService, 'cancel').mockRejectedValue(new NotFoundError());
  const get = spyOn(appsService, 'get');
  expect(
    (
      await sendJson({
        method: 'PUT',
        url: URL,
        body: CANCELLATION,
        headers: { cookie: account.cookie },
      })
    ).status,
  ).toBe(StatusMap['Not Found']);
  cancel.mockRejectedValue(new ConflictError());
  expect(
    (
      await sendJson({
        method: 'PUT',
        url: URL,
        body: CANCELLATION,
        headers: { cookie: account.cookie },
      })
    ).status,
  ).toBe(StatusMap.Conflict);
  expect(get).not.toHaveBeenCalled();
});
