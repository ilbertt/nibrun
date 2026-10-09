import { afterAll, beforeAll, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import { type AppId, AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { SQL } from 'bun';
import type { Queries } from '#db/queries.gen.ts';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { TrustedWorkflowsRepository } from '#repositories/trusted-workflows.repository.ts';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';
import { trustedWorkflow } from '#tests/support/trusted-workflows.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;
const OWNER_ID = Value.Parse(OwnerIdSchema, 'workflow-owner');
const OTHER_OWNER_ID = Value.Parse(OwnerIdSchema, 'workflow-stranger');
let sql: SQL;
let appId: AppId;
let deletedAppId: AppId;

beforeAll(async () => {
  sql = await startTestDatabase();
  for (const ownerId of [OWNER_ID, OTHER_OWNER_ID]) {
    await sql.unsafe(
      `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $1, $2, true, now(), now())`,
      [ownerId, `${ownerId}@example.test`],
    );
  }
  const rows = await sql.unsafe(
    `INSERT INTO nibrun.apps (owner_id, name, slug)
     VALUES ($1, 'CI app', 'workflow-main'), ($1, 'Deleted CI app', 'workflow-deleted') RETURNING id`,
    [OWNER_ID],
  );
  appId = Value.Parse(AppIdSchema, rows[0].id);
  deletedAppId = Value.Parse(AppIdSchema, rows[1].id);
}, DATABASE_START_TIMEOUT_MS);

afterAll(async () => {
  await stopTestDatabase(sql);
}, DATABASE_START_TIMEOUT_MS);

function repository() {
  return new TrustedWorkflowsRepository(withTypes<Queries>(sql));
}

test('independent instances share one replaceable workflow per app', async () => {
  const workflow = trustedWorkflow();
  expect(await repository().save({ appId, ownerId: OWNER_ID, workflow })).toEqual(workflow);
  expect(await repository().find({ appId, ownerId: OWNER_ID })).toEqual(workflow);
  const replacement = trustedWorkflow({ branch: 'production', environment: 'production' });
  expect(await repository().save({ appId, ownerId: OWNER_ID, workflow: replacement })).toEqual(
    replacement,
  );
  expect(await repository().find({ appId, ownerId: OWNER_ID })).toEqual(replacement);
  const rows = await sql.unsafe(
    'SELECT id, created_at, updated_at FROM nibrun.trusted_workflows WHERE app_id = $1',
    [appId],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].created_at).toBeInstanceOf(Date);
  expect(rows[0].updated_at).toBeInstanceOf(Date);
});

test('all reads and writes enforce ownership inside SQL', async () => {
  const owner = { appId, ownerId: OWNER_ID };
  const stranger = { appId, ownerId: OTHER_OWNER_ID };
  const workflow = trustedWorkflow();
  await repository().save({ ...owner, workflow });
  expect(await repository().find(stranger)).toBeNull();
  expect(
    await repository().save({
      ...stranger,
      workflow: trustedWorkflow({ repository: 'attacker/backend' }),
    }),
  ).toBeNull();
  expect(await repository().remove(stranger)).toBe(false);
  expect(await repository().find(owner)).toEqual(workflow);
  expect(await repository().remove(owner)).toBe(true);
  expect(await repository().find(owner)).toBeNull();
});

test('a deleted app cannot read, replace, or create a trusted workflow', async () => {
  const owner = { appId: deletedAppId, ownerId: OWNER_ID };
  await repository().save({ ...owner, workflow: trustedWorkflow() });
  await sql.unsafe("UPDATE nibrun.apps SET state = 'deleted' WHERE id = $1", [deletedAppId]);
  expect(await repository().find(owner)).toBeNull();
  expect(
    await repository().save({ ...owner, workflow: trustedWorkflow({ branch: 'other' }) }),
  ).toBeNull();
  expect(await repository().remove(owner)).toBe(false);
});
