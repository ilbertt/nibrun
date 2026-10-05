import { afterAll, beforeAll, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import { type AppId, AppIdSchema, GuestPathSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { SQL } from 'bun';
import type { Queries } from '#db/queries.gen.ts';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { SqliteConnectionsRepository } from '#repositories/sqlite-connections.repository.ts';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;
const OWNER_ID = Value.Parse(OwnerIdSchema, 'sqlite-owner');
const OTHER_OWNER_ID = Value.Parse(OwnerIdSchema, 'sqlite-stranger');
const PATH = Value.Parse(GuestPathSchema, '/app.db');
let sql: SQL;
let appId: AppId;
let otherAppId: AppId;

beforeAll(async () => {
  sql = await startTestDatabase();
  for (const ownerId of [OWNER_ID, OTHER_OWNER_ID]) {
    await sql.unsafe(
      `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES ($1, $1, $2, true, now(), now())`,
      [ownerId, `${ownerId}@example.test`],
    );
  }
  const apps = await sql.unsafe(
    `INSERT INTO nibrun.apps (owner_id, name, slug)
    VALUES ($1, 'SQLite app', 'sqlite-primary'), ($1, 'Other app', 'sqlite-other') RETURNING id`,
    [OWNER_ID],
  );
  appId = Value.Parse(AppIdSchema, apps[0].id);
  otherAppId = Value.Parse(AppIdSchema, apps[1].id);
}, DATABASE_START_TIMEOUT_MS);

afterAll(async () => {
  await stopTestDatabase(sql);
}, DATABASE_START_TIMEOUT_MS);

function repository() {
  return new SqliteConnectionsRepository(withTypes<Queries>(sql));
}

test('the saved database path is shared by independent repository instances', async () => {
  const saved = await repository().create({ appId, ownerId: OWNER_ID, path: PATH });
  if (!saved) {
    throw new Error('Expected a saved connection');
  }
  expect(saved.created_at).toBeInstanceOf(Date);
  expect(await repository().findById({ id: saved.id, ownerId: OWNER_ID })).toEqual(saved);
  expect(await repository().listByApp({ appId, ownerId: OWNER_ID })).toContainEqual(saved);
});

test('every connection statement checks app ownership in the database', async () => {
  const saved = await repository().create({ appId, ownerId: OWNER_ID, path: PATH });
  if (!saved) {
    throw new Error('Expected a saved connection');
  }
  expect(await repository().create({ appId, ownerId: OTHER_OWNER_ID, path: PATH })).toBeNull();
  expect(await repository().listByApp({ appId, ownerId: OTHER_OWNER_ID })).toEqual([]);
  expect(await repository().findById({ id: saved.id, ownerId: OTHER_OWNER_ID })).toBeNull();
  expect(await repository().remove({ appId, id: saved.id, ownerId: OTHER_OWNER_ID })).toBe(false);
  expect(await repository().remove({ appId: otherAppId, id: saved.id, ownerId: OWNER_ID })).toBe(
    false,
  );
  expect(await repository().findById({ id: saved.id, ownerId: OWNER_ID })).toEqual(saved);
  expect(await repository().remove({ appId, id: saved.id, ownerId: OWNER_ID })).toBe(true);
  expect(await repository().findById({ id: saved.id, ownerId: OWNER_ID })).toBeNull();
});

test('deleted apps cannot create or expose saved connection links', async () => {
  const saved = await repository().create({ appId: otherAppId, ownerId: OWNER_ID, path: PATH });
  if (!saved) {
    throw new Error('Expected a saved connection');
  }
  await sql.unsafe(`UPDATE nibrun.apps SET state = 'deleted' WHERE id = $1`, [otherAppId]);
  expect(
    await repository().create({ appId: otherAppId, ownerId: OWNER_ID, path: PATH }),
  ).toBeNull();
  expect(await repository().listByApp({ appId: otherAppId, ownerId: OWNER_ID })).toEqual([]);
  expect(await repository().findById({ id: saved.id, ownerId: OWNER_ID })).toBeNull();
});
