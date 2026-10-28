import { afterAll, beforeAll, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import { MAX_PAID_APPS_REQUEST } from '@repo/api-constants';
import { AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { SQL } from 'bun';
import { type IPaidRequestsColumns, type Queries, schema } from '#db/queries.gen.ts';
import { type OwnerId, OwnerIdSchema } from '#lib/api/identifiers.ts';
import { getMigrations } from '#lib/assets.ts';
import {
  type PaidRequestRow,
  PaidRequestsRepository,
} from '#repositories/paid-requests.repository.ts';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';
import {
  APP_PAID_REQUESTS,
  CUSTOM_BUCKET_REQUEST,
  paidRequestRow,
  RESOURCES_REQUEST,
} from '#tests/support/paid-requests.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;
const OWNER_ID = Value.Parse(OwnerIdSchema, 'paid-owner');
const OTHER_OWNER_ID = Value.Parse(OwnerIdSchema, 'paid-other');
const SECOND_APP_ID = Value.Parse(AppIdSchema, '019a0a00-0000-7000-8000-000000000002');
const OTHER_APP_ID = Value.Parse(AppIdSchema, '019a0a00-0000-7000-8000-000000000003');
const MISSING_APP_ID = Value.Parse(AppIdSchema, '019a0a00-0000-7000-8000-000000000004');
let sql: SQL;

beforeAll(async function startDatabase() {
  sql = await startTestDatabase();
  for (const ownerId of [OWNER_ID, OTHER_OWNER_ID]) {
    await sql.unsafe(
      `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, $1, $2, true, now(), now())`,
      [ownerId, `${ownerId}@example.test`],
    );
  }
  for (const [appId, ownerId] of [
    [CUSTOM_BUCKET_REQUEST.appId, OWNER_ID],
    [SECOND_APP_ID, OWNER_ID],
    [OTHER_APP_ID, OTHER_OWNER_ID],
  ]) {
    await sql.unsafe('INSERT INTO nibrun.apps (id, owner_id, slug, name) VALUES ($1, $2, $3, $3)', [
      appId,
      ownerId,
      appId,
    ]);
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
    `SELECT request_type, requested_apps_amount, app_id, requested_vcpu_count,
       requested_memory_mib, requested_volume_gib FROM nibrun.paid_requests WHERE owner_id = $1`,
    [ownerId],
  )) as PaidRequestRow[];
}

test('the upgrade preserves valid requests and requires app IDs for app features', async () => {
  const migrations = getMigrations();
  await sql.begin(async function upgradePaidRequests(transaction) {
    await transaction.unsafe('DROP TABLE nibrun.paid_requests');
    for (const name of [
      '0067_paid_requests.sql',
      '0069_custom_bucket_paid_requests.sql',
      '0070_bucket_requests_name_an_app.sql',
      '0075_always_on_paid_requests.sql',
    ]) {
      await transaction.unsafe(await migrations.get(name)!.text());
    }
    await transaction.unsafe(
      `INSERT INTO nibrun.paid_requests (owner_id, request_type, requested_apps_amount, app_id)
       VALUES ($1, 'apps', 10, NULL), ($1, 'custom-bucket', NULL, $2), ($1, 'always-on', NULL, $2)`,
      [OWNER_ID, CUSTOM_BUCKET_REQUEST.appId],
    );
    const before = await transaction.unsafe<
      Pick<IPaidRequestsColumns, 'id' | 'request_type' | 'requested_apps_amount' | 'app_id'>[]
    >(
      'SELECT id, request_type, requested_apps_amount, app_id FROM nibrun.paid_requests WHERE owner_id = $1 ORDER BY request_type',
      [OWNER_ID],
    );
    await transaction.unsafe(await migrations.get('0076_resources_paid_requests.sql')!.text());
    const after = await transaction.unsafe(
      'SELECT id, request_type, requested_apps_amount, app_id FROM nibrun.paid_requests WHERE owner_id = $1 ORDER BY request_type',
      [OWNER_ID],
    );
    expect([...after]).toEqual([...before]);
    for (const request of APP_PAID_REQUESTS) {
      await expect(
        transaction.savepoint(async function refuseUnscopedAppRequest(savepoint) {
          await savepoint.unsafe(
            'INSERT INTO nibrun.paid_requests (owner_id, request_type) VALUES ($1, $2)',
            [OTHER_OWNER_ID, request.requestType],
          );
        }),
      ).rejects.toMatchObject({ errno: '23514' });
    }
    await expect(
      transaction.savepoint(async function refuseAppScopedCount(savepoint) {
        await savepoint.unsafe(
          `INSERT INTO nibrun.paid_requests (owner_id, request_type, requested_apps_amount, app_id)
         VALUES ($1, 'apps', 10, $2)`,
          [OWNER_ID, CUSTOM_BUCKET_REQUEST.appId],
        );
      }),
    ).rejects.toMatchObject({ errno: '23514' });
    await transaction.unsafe('DELETE FROM nibrun.paid_requests WHERE owner_id = $1', [OWNER_ID]);
  });
});

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
  expect(await repository().save({ ownerId: OWNER_ID, request: updated })).toEqual(
    paidRequestRow(updated),
  );
  const [after] = await sql.unsafe(
    'SELECT id, created_at, updated_at FROM nibrun.paid_requests WHERE owner_id = $1',
    [OWNER_ID],
  );
  expect(after.id).toBe(before.id);
  expect(after.created_at).toEqual(before.created_at);
  expect(after.updated_at.getTime()).toBeGreaterThanOrEqual(before.updated_at.getTime());
  expect(await savedRequests(OWNER_ID)).toEqual([paidRequestRow(updated)]);
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
    paidRequestRow({ requestType: 'apps', requestedAppsAmount: 1 }),
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

test.each(APP_PAID_REQUESTS)(
  '$requestType requests are idempotent, owner scoped and coexist with other requests',
  async (request) => {
    const before = await savedRequests(OWNER_ID);
    const otherBefore = await savedRequests(OTHER_OWNER_ID);
    const expected = paidRequestRow(request);
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
    const otherRequest = { ...request, appId: OTHER_APP_ID };
    await repository().save({ ownerId: OTHER_OWNER_ID, request: otherRequest });
    expect(await savedRequests(OWNER_ID)).toEqual(expect.arrayContaining([...before, expected]));
    expect(await savedRequests(OTHER_OWNER_ID)).toEqual(
      expect.arrayContaining([...otherBefore, { ...expected, app_id: OTHER_APP_ID }]),
    );
  },
);

test.each(APP_PAID_REQUESTS)(
  '$requestType requests for two apps owned by the same account are retained independently',
  async (featureRequest) => {
    const request = { ...featureRequest, appId: SECOND_APP_ID };
    expect(await repository().save({ ownerId: OWNER_ID, request })).toEqual(
      paidRequestRow(request),
    );
    const requests = (await savedRequests(OWNER_ID)).filter(
      (row) => row.request_type === request.requestType,
    );
    expect(requests).toHaveLength(2);
    expect(requests.map((row) => row.app_id)).toEqual(
      expect.arrayContaining([CUSTOM_BUCKET_REQUEST.appId, SECOND_APP_ID]),
    );
  },
);

test.each(APP_PAID_REQUESTS)(
  'missing and unowned apps cannot create or replace a $requestType request',
  async (request) => {
    const before = await savedRequests(OWNER_ID);
    for (const appId of [MISSING_APP_ID, OTHER_APP_ID]) {
      expect(
        await repository().save({
          ownerId: OWNER_ID,
          request: { ...request, appId },
        }),
      ).toBeNull();
    }
    expect(await savedRequests(OWNER_ID)).toEqual(before);
  },
);

test('resubmitting resource amounts replaces the previous amounts on the same request', async () => {
  const [before] = await sql.unsafe(
    `SELECT id FROM nibrun.paid_requests WHERE owner_id = $1 AND request_type = 'resources' AND app_id = $2`,
    [OWNER_ID, RESOURCES_REQUEST.appId],
  );
  const request = {
    ...RESOURCES_REQUEST,
    requestedVcpuCount: RESOURCES_REQUEST.requestedVcpuCount,
    requestedMemoryMib: 1_024,
    requestedVolumeGib: RESOURCES_REQUEST.requestedVolumeGib,
  };
  expect(await repository().save({ ownerId: OWNER_ID, request })).toEqual(paidRequestRow(request));
  const [after] = await sql.unsafe(
    `SELECT id FROM nibrun.paid_requests WHERE owner_id = $1 AND request_type = 'resources' AND app_id = $2`,
    [OWNER_ID, RESOURCES_REQUEST.appId],
  );
  expect(after.id).toBe(before.id);
  expect(await savedRequests(OWNER_ID)).toContainEqual(paidRequestRow(request));
});

test.each(['requested_vcpu_count', 'requested_memory_mib', 'requested_volume_gib'])(
  'database constraints require %s only for resources requests',
  async (column) => {
    for (const amount of [null, 0, -1]) {
      await expect(
        sql
          .unsafe(
            `UPDATE nibrun.paid_requests SET ${column} = $1 WHERE owner_id = $2 AND request_type = 'resources'`,
            [amount, OWNER_ID],
          )
          .execute(),
      ).rejects.toMatchObject({ errno: '23514' });
    }
    await expect(
      sql
        .unsafe(
          `UPDATE nibrun.paid_requests SET ${column} = 1 WHERE owner_id = $1 AND request_type <> 'resources'`,
          [OWNER_ID],
        )
        .execute(),
    ).rejects.toMatchObject({ errno: '23514' });
  },
);

test('deleted apps cannot be requested and hard deletion removes their requests', async () => {
  await sql.unsafe('UPDATE nibrun.apps SET state = $2 WHERE id = $1 AND owner_id = $3', [
    SECOND_APP_ID,
    'deleted',
    OWNER_ID,
  ]);
  for (const request of APP_PAID_REQUESTS) {
    expect(
      await repository().save({
        ownerId: OWNER_ID,
        request: { ...request, appId: SECOND_APP_ID },
      }),
    ).toBeNull();
  }
  await sql.unsafe('DELETE FROM nibrun.apps WHERE id = $1 AND owner_id = $2', [
    SECOND_APP_ID,
    OWNER_ID,
  ]);
  expect((await savedRequests(OWNER_ID)).some((row) => row.app_id === SECOND_APP_ID)).toBe(false);
});

test('deleting an account also removes its paid requests', async () => {
  await sql.unsafe('DELETE FROM nibrun.apps WHERE owner_id = $1', [OTHER_OWNER_ID]);
  await sql.unsafe('DELETE FROM auth."user" WHERE id = $1', [OTHER_OWNER_ID]);
  expect(await savedRequests(OTHER_OWNER_ID)).toEqual([]);
});
