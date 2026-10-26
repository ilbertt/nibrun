import { afterAll, beforeAll, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import { MAX_PAID_APPS_REQUEST } from '@repo/api-constants';
import { Value } from '@sinclair/typebox/value';
import type { SQL } from 'bun';
import { type Queries, schema } from '#db/queries.gen.ts';
import { type OwnerId, OwnerIdSchema } from '#lib/api/identifiers.ts';
import {
  type PaidRequestRow,
  PaidRequestsRepository,
} from '#repositories/paid-requests.repository.ts';
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

async function savedRequests(ownerId: OwnerId): Promise<PaidRequestRow[]> {
  return (await sql.unsafe(
    'SELECT request_type, requested_apps_amount FROM nibrun.paid_requests WHERE owner_id = $1',
    [ownerId],
  )) as PaidRequestRow[];
}

test('repeated and concurrent submissions keep one latest request per owner and type', async () => {
  const request = { requestType: 'apps' as const, requestedAppsAmount: 10 };
  await Promise.all([
    repository().save({ ownerId: OWNER_ID, request }),
    repository().save({ ownerId: OWNER_ID, request }),
  ]);
  const [before] = await sql.unsafe(
    'SELECT id, created_at, updated_at FROM nibrun.paid_requests WHERE owner_id = $1',
    [OWNER_ID],
  );
  expect(before.created_at).toBeInstanceOf(Date);
  const updated = { ...request, requestedAppsAmount: 100 };
  expect(await repository().save({ ownerId: OWNER_ID, request: updated })).toEqual({
    request_type: 'apps',
    requested_apps_amount: updated.requestedAppsAmount,
  });
  const [after] = await sql.unsafe(
    'SELECT id, created_at, updated_at FROM nibrun.paid_requests WHERE owner_id = $1',
    [OWNER_ID],
  );
  expect(after.id).toBe(before.id);
  expect(after.created_at).toEqual(before.created_at);
  expect(after.updated_at.getTime()).toBeGreaterThanOrEqual(before.updated_at.getTime());
  expect(await savedRequests(OWNER_ID)).toEqual([
    { request_type: 'apps', requested_apps_amount: updated.requestedAppsAmount },
  ]);
});

test('another owner’s submission cannot overwrite the first owner’s request', async () => {
  const first = await savedRequests(OWNER_ID);
  expect(await savedRequests(OTHER_OWNER_ID)).toEqual([]);
  await repository().save({
    ownerId: OTHER_OWNER_ID,
    request: { requestType: 'apps', requestedAppsAmount: 1 },
  });
  expect(await savedRequests(OWNER_ID)).toEqual(first);
  expect(await savedRequests(OTHER_OWNER_ID)).toEqual([
    { request_type: 'apps', requested_apps_amount: 1 },
  ]);
});

test('database constraints enforce allowed types, whole totals from 1–100, and a real owner', async () => {
  for (const amount of [0, -1, MAX_PAID_APPS_REQUEST + 1, null]) {
    await expect(
      sql
        .unsafe(`UPDATE nibrun.paid_requests SET requested_apps_amount = $2 WHERE owner_id = $1`, [
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
        `INSERT INTO nibrun.paid_requests (owner_id, request_type, requested_apps_amount) VALUES ('missing-owner', 'apps', 10)`,
      )
      .execute(),
  ).rejects.toMatchObject({ errno: '23503' });
});

test('future request types require a null requested app count', async function futureRequestType() {
  await sql.begin(async function testFutureType(transaction) {
    await transaction.unsafe(
      'CREATE TEMP TABLE future_paid_requests (LIKE nibrun.paid_requests INCLUDING ALL) ON COMMIT DROP',
    );
    const typeConstraint =
      schema.paid_requests._constraints.paid_requests_type_check._constraintName;
    await transaction.unsafe(
      `ALTER TABLE pg_temp.future_paid_requests DROP CONSTRAINT ${typeConstraint}`,
    );
    await transaction.unsafe(
      `INSERT INTO pg_temp.future_paid_requests (owner_id, request_type, requested_apps_amount)
       VALUES ($1, 'future-type', NULL)`,
      [OWNER_ID],
    );
    for (const amount of [0, 1, MAX_PAID_APPS_REQUEST]) {
      await expect(
        transaction.savepoint(async function refuseAppsAmount(savepoint) {
          await savepoint.unsafe(
            'UPDATE pg_temp.future_paid_requests SET requested_apps_amount = $2 WHERE owner_id = $1',
            [OWNER_ID, amount],
          );
        }),
      ).rejects.toMatchObject({
        errno: '23514',
        constraint:
          schema.paid_requests._constraints.paid_requests_requested_apps_amount_check
            ._constraintName,
      });
    }
  });
});

test('bucket requests are idempotent, owner scoped and coexist with app requests', async () => {
  const before = await savedRequests(OWNER_ID);
  const otherBefore = await savedRequests(OTHER_OWNER_ID);
  const request = { requestType: 'custom-bucket' as const };
  const expected: PaidRequestRow = { request_type: 'custom-bucket', requested_apps_amount: null };
  const [first, repeated] = await Promise.all([
    repository().save({ ownerId: OWNER_ID, request }),
    repository().save({ ownerId: OWNER_ID, request }),
  ]);
  expect(first).toEqual(expected);
  expect(repeated).toEqual(expected);
  expect(await savedRequests(OWNER_ID)).toHaveLength(before.length + 1);
  expect(await savedRequests(OWNER_ID)).toEqual(expect.arrayContaining([...before, expected]));
  const [id] = await sql.unsafe(
    'SELECT id FROM nibrun.paid_requests WHERE owner_id = $1 AND request_type = $2',
    [OWNER_ID, request.requestType],
  );
  await repository().save({ ownerId: OWNER_ID, request });
  const [saved] = await sql.unsafe(
    'SELECT id FROM nibrun.paid_requests WHERE owner_id = $1 AND request_type = $2',
    [OWNER_ID, request.requestType],
  );
  expect(saved.id).toBe(id.id);
  await expect(
    sql
      .unsafe(
        'UPDATE nibrun.paid_requests SET requested_apps_amount = 1 WHERE owner_id = $1 AND request_type = $2',
        [OWNER_ID, request.requestType],
      )
      .execute(),
  ).rejects.toMatchObject({ errno: '23514' });
  expect(await savedRequests(OTHER_OWNER_ID)).toEqual(otherBefore);
  await repository().save({ ownerId: OTHER_OWNER_ID, request });
  expect(await savedRequests(OWNER_ID)).toEqual(expect.arrayContaining([...before, expected]));
  expect(await savedRequests(OTHER_OWNER_ID)).toEqual(
    expect.arrayContaining([...otherBefore, expected]),
  );
});

test('deleting an account also removes its paid requests', async () => {
  await sql.unsafe('DELETE FROM auth."user" WHERE id = $1', [OTHER_OWNER_ID]);
  expect(await savedRequests(OTHER_OWNER_ID)).toEqual([]);
});
