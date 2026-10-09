import { afterAll, beforeAll, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import { type AppId, AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { SQL } from 'bun';
import type { Queries } from '#db/queries.gen.ts';
import { OwnerIdSchema, TrustedWorkflowIdSchema } from '#lib/api/identifiers.ts';
import { ConflictError, NotFoundError } from '#lib/errors.ts';
import { TrustedWorkflowsRepository } from '#repositories/trusted-workflows.repository.ts';
import { TrustedWorkflowsService } from '#services/trusted-workflows.service.ts';
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

function service() {
  return new TrustedWorkflowsService({ workflowsRepo: repository() });
}

test('creation is exclusive and replacement preserves the workflow identity', async () => {
  const owner = { appId, ownerId: OWNER_ID };
  const workflow = trustedWorkflow();
  const created = await service().create({ ...owner, workflow });
  expect(created).toEqual({ id: expect.any(String), ...workflow });
  expect(await repository().find(owner)).toEqual(created);
  await expect(
    service().create({ ...owner, workflow: trustedWorkflow({ branch: 'unwanted' }) }),
  ).rejects.toBeInstanceOf(ConflictError);
  expect(await repository().find(owner)).toEqual(created);
  const replacement = trustedWorkflow({ branch: 'production', environment: 'production' });
  expect(
    await service().update({ ...owner, workflowId: created.id, workflow: replacement }),
  ).toEqual({ id: created.id, ...replacement });
  const rows = await sql.unsafe(
    'SELECT id, created_at, updated_at FROM nibrun.github_trusted_deployment_workflows WHERE app_id = $1',
    [appId],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBe(created.id);
  expect(rows[0].created_at).toBeInstanceOf(Date);
  expect(rows[0].updated_at).toBeInstanceOf(Date);
  await service().remove({ ...owner, workflowId: created.id });
});

test('all reads and writes enforce the owner and app inside SQL', async () => {
  const owner = { appId, ownerId: OWNER_ID };
  const stranger = { appId, ownerId: OTHER_OWNER_ID };
  const created = await service().create({ ...owner, workflow: trustedWorkflow() });
  const ownedWorkflow = { ...owner, workflowId: created.id };
  expect(await repository().find(stranger)).toBeNull();
  expect(await repository().create({ ...stranger, workflow: trustedWorkflow() })).toBeNull();
  expect(
    await repository().update({
      ...stranger,
      workflowId: created.id,
      workflow: trustedWorkflow({ repository: 'attacker/backend' }),
    }),
  ).toBeNull();
  expect(await repository().remove({ ...stranger, workflowId: created.id })).toBe(false);
  const otherApp = { ...ownedWorkflow, appId: deletedAppId };
  expect(await repository().update({ ...otherApp, workflow: trustedWorkflow() })).toBeNull();
  expect(await repository().remove(otherApp)).toBe(false);
  expect(await repository().find(owner)).toEqual(created);
  expect(await repository().remove(ownedWorkflow)).toBe(true);
  expect(await repository().find(owner)).toBeNull();
});

test('stale workflow IDs cannot update or delete a replacement configuration', async () => {
  const owner = { appId, ownerId: OWNER_ID };
  const first = await service().create({ ...owner, workflow: trustedWorkflow() });
  const stale = { ...owner, workflowId: first.id };
  await service().remove(stale);
  await expect(service().update({ ...stale, workflow: trustedWorkflow() })).rejects.toBeInstanceOf(
    NotFoundError,
  );
  const replacement = await service().create({
    ...owner,
    workflow: trustedWorkflow({ branch: 'production' }),
  });
  expect(replacement.id).not.toBe(first.id);
  await expect(service().update({ ...stale, workflow: trustedWorkflow() })).rejects.toBeInstanceOf(
    NotFoundError,
  );
  await expect(service().remove(stale)).rejects.toBeInstanceOf(NotFoundError);
  expect(await service().find(owner)).toEqual(replacement);
  const missing = {
    ...owner,
    workflowId: Value.Parse(TrustedWorkflowIdSchema, Bun.randomUUIDv7()),
  };
  expect(await repository().update({ ...missing, workflow: trustedWorkflow() })).toBeNull();
  await service().remove({ ...owner, workflowId: replacement.id });
});

test('a deleted app cannot read, update, create, or remove a trusted workflow', async () => {
  const owner = { appId: deletedAppId, ownerId: OWNER_ID };
  const created = await service().create({ ...owner, workflow: trustedWorkflow() });
  const ownedWorkflow = { ...owner, workflowId: created.id };
  await sql.unsafe("UPDATE nibrun.apps SET state = 'deleted' WHERE id = $1", [deletedAppId]);
  expect(await repository().find(owner)).toBeNull();
  expect(await repository().create({ ...owner, workflow: trustedWorkflow() })).toBeNull();
  expect(
    await repository().update({ ...ownedWorkflow, workflow: trustedWorkflow({ branch: 'other' }) }),
  ).toBeNull();
  expect(await repository().remove(ownedWorkflow)).toBe(false);
});
