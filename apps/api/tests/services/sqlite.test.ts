import { expect, test } from 'bun:test';
import { GuestPathSchema } from '@repo/protocol';
import { HranaError } from '@repo/sqlite';
import { Value } from '@sinclair/typebox/value';
import { BadRequestError, ConflictError, NotFoundError } from '#lib/errors.ts';
import { SqliteService } from '#services/sqlite.service.ts';
import {
  APP_ID,
  DEPLOYMENT_ID,
  OTHER_OWNER_ID,
  OWNER_ID,
} from '#tests/services/support/fixtures.ts';
import { sqliteConnectionsFixture } from '#tests/support/sqlite-connections.ts';

const PATH = Value.Parse(GuestPathSchema, '/app.db');
const SIGNAL = new AbortController().signal;

test('creating a saved connection verifies the file and returns a stable URL', async () => {
  const fixture = sqliteConnectionsFixture();
  const saved = await new SqliteService(fixture).create({
    appId: APP_ID,
    ownerId: OWNER_ID,
    sqlite_file_path: PATH,
    signal: SIGNAL,
  });
  expect(saved).toMatchObject({ appId: APP_ID, sqlite_file_path: PATH });
  expect(saved.url).toBe(`https://api.test/api/sqlite/connections/${saved.id}/`);
  expect(saved).not.toHaveProperty('expiresAt');
  expect(saved).not.toHaveProperty('deploymentId');
  expect(fixture.opened).toEqual([
    { appId: APP_ID, deploymentId: DEPLOYMENT_ID, path: PATH, signal: SIGNAL },
  ]);
  expect(fixture.sessions[0]?.closed).toBe(true);
  expect(await new SqliteService(fixture).list({ appId: APP_ID, ownerId: OWNER_ID })).toEqual([
    saved,
  ]);
  fixture.deployment.state = 'stopped';
  expect(await new SqliteService(fixture).list({ appId: APP_ID, ownerId: OWNER_ID })).toEqual([
    saved,
  ]);
});

test('another owner cannot create, list or delete a saved connection', async () => {
  const fixture = sqliteConnectionsFixture();
  const service = new SqliteService(fixture);
  await expect(
    service.create({
      appId: APP_ID,
      ownerId: OTHER_OWNER_ID,
      sqlite_file_path: PATH,
      signal: SIGNAL,
    }),
  ).rejects.toBeInstanceOf(NotFoundError);
  expect(fixture.opened).toHaveLength(0);
  const saved = await service.create({
    appId: APP_ID,
    ownerId: OWNER_ID,
    sqlite_file_path: PATH,
    signal: SIGNAL,
  });
  expect(await service.list({ appId: APP_ID, ownerId: OTHER_OWNER_ID })).toEqual([]);
  await expect(
    service.removeConnection({ appId: APP_ID, id: saved.id, ownerId: OTHER_OWNER_ID }),
  ).rejects.toBeInstanceOf(NotFoundError);
  await service.removeConnection({ appId: APP_ID, id: saved.id, ownerId: OWNER_ID });
  expect(await service.list({ appId: APP_ID, ownerId: OWNER_ID })).toEqual([]);
});

test('a stopped deployment is refused before verifying a new connection', async () => {
  const fixture = sqliteConnectionsFixture();
  fixture.deployment.state = 'stopped';
  await expect(
    new SqliteService(fixture).create({
      appId: APP_ID,
      ownerId: OWNER_ID,
      sqlite_file_path: PATH,
      signal: SIGNAL,
    }),
  ).rejects.toBeInstanceOf(ConflictError);
  expect(fixture.opened).toHaveLength(0);
  expect(fixture.records).toHaveLength(0);
});

test('a database that fails to open leaves no saved connection', async () => {
  const fixture = sqliteConnectionsFixture();
  const service = new SqliteService({
    ...fixture,
    openSession() {
      return Promise.reject(new Error('not a database'));
    },
  });
  await expect(
    service.create({ appId: APP_ID, ownerId: OWNER_ID, sqlite_file_path: PATH, signal: SIGNAL }),
  ).rejects.toThrow('not a database');
  expect(fixture.records).toHaveLength(0);
});

test('a file that is not a database reports a client error', async () => {
  const fixture = sqliteConnectionsFixture();
  const service = new SqliteService({
    ...fixture,
    openSession() {
      return Promise.reject(
        new HranaError({ code: 'SQLITE_26', message: 'file is not a database' }),
      );
    },
  });
  await expect(
    service.create({ appId: APP_ID, ownerId: OWNER_ID, sqlite_file_path: PATH, signal: SIGNAL }),
  ).rejects.toBeInstanceOf(BadRequestError);
  expect(fixture.records).toHaveLength(0);
});

test('saved connection metadata is owner-scoped and does not require a running deployment', async () => {
  const fixture = sqliteConnectionsFixture();
  const service = new SqliteService(fixture);
  const saved = await service.create({
    appId: APP_ID,
    ownerId: OWNER_ID,
    sqlite_file_path: PATH,
    signal: SIGNAL,
  });
  fixture.deployment.state = 'stopped';
  const deploymentLookups = fixture.asked.length;
  expect(await service.getConnection({ id: saved.id, ownerId: OWNER_ID })).toEqual(saved);
  expect(fixture.asked).toHaveLength(deploymentLookups);
  expect(fixture.opened).toHaveLength(1);
  await expect(
    service.getConnection({ id: saved.id, ownerId: OTHER_OWNER_ID }),
  ).rejects.toBeInstanceOf(NotFoundError);
  await service.removeConnection({ appId: APP_ID, id: saved.id, ownerId: OWNER_ID });
  await expect(service.getConnection({ id: saved.id, ownerId: OWNER_ID })).rejects.toBeInstanceOf(
    NotFoundError,
  );
});
