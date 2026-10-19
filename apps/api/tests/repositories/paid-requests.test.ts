import { afterAll, beforeAll, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import { MAX_PAID_APPS_REQUEST } from '@repo/api-constants';
import { Value } from '@sinclair/typebox/value';
import type { SQL } from 'bun';
import type { Queries } from '#db/queries.gen.ts';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { PaidRequestsRepository } from '#repositories/paid-requests.repository.ts';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;
const OWNER_ID = Value.Parse(OwnerIdSchema, 'paid-owner');
const OTHER_OWNER_ID = Value.Parse(OwnerIdSchema, 'paid-other');
let sql: SQL;

beforeAll(async function startDatabase() {
  sql = await startTestDatabase();
  for (const ownerId of [OWNER_ID, OTHER_OWNER_ID]) {
    await sql.unsafe(
      `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, $1, $2, true, now(), now())`,
      [ownerId, `${ownerId}@example.test`],
    );
  }
}, DATABASE_START_TIMEOUT_MS);

afterAll(async function stopDatabase() {
  await stopTestDatabase(sql);
}, DATABASE_START_TIMEOUT_MS);

function repository() {
  return new PaidRequestsRepository(withTypes<Queries>(sql));
}

test('repeated and concurrent submissions keep one latest request per owner and type', async () => {
  const request = { requestType: 'apps' as const, amount: 10 };
  await Promise.all([
    repository().save({ ownerId: OWNER_ID, request }),
    repository().save({ ownerId: OWNER_ID, request }),
  ]);
  const [before] = await sql.unsafe(
    'SELECT id, created_at, updated_at FROM nibrun.paid_requests WHERE owner_id = $1',
    [OWNER_ID],
  );
  expect(before.created_at).toBeInstanceOf(Date);
  const updated = { ...request, amount: 100 };
  expect(await repository().save({ ownerId: OWNER_ID, request: updated })).toEqual({
    request_type: 'apps',
    amount: updated.amount,
  });
  const [after] = await sql.unsafe(
    'SELECT id, created_at, updated_at FROM nibrun.paid_requests WHERE owner_id = $1',
    [OWNER_ID],
  );
  expect(after.id).toBe(before.id);
  expect(after.created_at).toEqual(before.created_at);
  expect(after.updated_at.getTime()).toBeGreaterThanOrEqual(before.updated_at.getTime());
  expect(await repository().list({ ownerId: OWNER_ID })).toEqual([
    { request_type: 'apps', amount: updated.amount },
  ]);
});

test('another owner cannot read or overwrite the first owner’s request', async () => {
  const first = await repository().list({ ownerId: OWNER_ID });
  expect(await repository().list({ ownerId: OTHER_OWNER_ID })).toEqual([]);
  await repository().save({ ownerId: OTHER_OWNER_ID, request: { requestType: 'apps', amount: 1 } });
  expect(await repository().list({ ownerId: OWNER_ID })).toEqual(first);
  expect(await repository().list({ ownerId: OTHER_OWNER_ID })).toEqual([
    { request_type: 'apps', amount: 1 },
  ]);
});

test('database constraints enforce allowed types, whole totals from 1–100, and a real owner', async () => {
  for (const amount of [0, -1, MAX_PAID_APPS_REQUEST + 1, null]) {
    await expect(
      sql
        .unsafe(`UPDATE nibrun.paid_requests SET amount = $2 WHERE owner_id = $1`, [
          OWNER_ID,
          amount,
        ])
        .execute(),
    ).rejects.toMatchObject({ errno: '23514' });
  }
  await expect(
    sql
      .unsafe(`UPDATE nibrun.paid_requests SET request_type = 'unknown' WHERE owner_id = $1`, [
        OWNER_ID,
      ])
      .execute(),
  ).rejects.toMatchObject({ errno: '23514' });
  await expect(
    sql
      .unsafe(
        `INSERT INTO nibrun.paid_requests (owner_id, request_type, amount) VALUES ('missing-owner', 'apps', 10)`,
      )
      .execute(),
  ).rejects.toMatchObject({ errno: '23503' });
});

test('deleting an account also removes its paid requests', async () => {
  await sql.unsafe('DELETE FROM auth."user" WHERE id = $1', [OTHER_OWNER_ID]);
  expect(await repository().list({ ownerId: OTHER_OWNER_ID })).toEqual([]);
});
