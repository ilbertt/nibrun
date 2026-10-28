import { afterAll, beforeAll, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import {
  type DeploymentId,
  DeploymentIdSchema,
  type HostId,
  TimestampSchema,
} from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { SQL } from 'bun';
import type { Queries } from '#db/queries.gen.ts';
import { AppsRepository } from '#repositories/apps.repository.ts';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';
import { createDeployedApp } from '#tests/support/deployed-app.ts';
import { registerHost } from '#tests/support/hosts.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;
let HOST_ID: HostId;
let OTHER_HOST_ID: HostId;
const FIRST_USAGE = {
  memoryTotalBytes: 8192,
  memoryUsedBytes: 4096,
  measuredAt: Value.Parse(TimestampSchema, '2026-10-28T10:00:00Z'),
};
const CURRENT_USAGE = {
  ...FIRST_USAGE,
  memoryUsedBytes: 2048,
  measuredAt: Value.Parse(TimestampSchema, '2026-10-28T11:00:00Z'),
};
const DELAYED_USAGE = {
  ...FIRST_USAGE,
  measuredAt: Value.Parse(TimestampSchema, '2026-10-28T12:00:00Z'),
};
let sql: SQL;

beforeAll(async function startDatabase() {
  sql = await startTestDatabase();
  HOST_ID = await registerHost({ sql, originId: 'original-host' });
  OTHER_HOST_ID = await registerHost({ sql, originId: 'other-host' });
}, DATABASE_START_TIMEOUT_MS);

afterAll(async function stopDatabase() {
  await stopTestDatabase(sql);
}, DATABASE_START_TIMEOUT_MS);

async function moveExecution({
  deploymentId,
  hostId,
}: {
  deploymentId: DeploymentId;
  hostId: HostId;
}) {
  return await sql.begin(async function replace(tx) {
    await tx.unsafe("UPDATE nibrun.deployments SET state = 'superseded' WHERE id = $1", [
      deploymentId,
    ]);
    const [row] = await tx.unsafe(
      `INSERT INTO nibrun.deployments (app_id, artifact_id, config_id, host_id)
       SELECT app_id, artifact_id, config_id, $1 FROM nibrun.deployments WHERE id = $2 RETURNING id`,
      [hostId, deploymentId],
    );
    return Value.Parse(DeploymentIdSchema, row.id);
  });
}

test('returning to a host does not let an old execution overwrite or clear current compute usage', async () => {
  const app = await createDeployedApp({ sql, name: 'returning-execution' });
  await sql.unsafe('UPDATE nibrun.deployments SET host_id = $1 WHERE id = $2', [
    HOST_ID,
    app.deploymentId,
  ]);
  const repository = new AppsRepository(withTypes<Queries>(sql));
  await repository.recordComputeUsage({
    readings: new Map([[app.deploymentId, FIRST_USAGE]]),
    hostId: HOST_ID,
  });
  const other = await moveExecution({ deploymentId: app.deploymentId, hostId: OTHER_HOST_ID });
  const current = await moveExecution({ deploymentId: other, hostId: HOST_ID });
  await repository.recordComputeUsage({
    readings: new Map([[current, CURRENT_USAGE]]),
    hostId: HOST_ID,
  });
  const [before] = await sql.unsafe('SELECT * FROM nibrun.app_usage WHERE app_id = $1', [
    app.appId,
  ]);
  expect(Number(before.memory_used_bytes)).toBe(CURRENT_USAGE.memoryUsedBytes);
  await repository.recordComputeUsage({
    readings: new Map([[app.deploymentId, DELAYED_USAGE]]),
    hostId: HOST_ID,
  });
  await repository.clearComputeUsage({ deploymentIds: [app.deploymentId], hostId: HOST_ID });
  await repository.recordComputeUsage({
    readings: new Map([[current, DELAYED_USAGE]]),
    hostId: OTHER_HOST_ID,
  });
  await repository.clearComputeUsage({ deploymentIds: [current], hostId: OTHER_HOST_ID });
  const [after] = await sql.unsafe('SELECT * FROM nibrun.app_usage WHERE app_id = $1', [app.appId]);
  expect(after).toEqual(before);
  await repository.clearComputeUsage({ deploymentIds: [current], hostId: HOST_ID });
  const [asleep] = await sql.unsafe(
    'SELECT memory_used_bytes FROM nibrun.app_usage WHERE app_id = $1',
    [app.appId],
  );
  expect(asleep.memory_used_bytes).toBeNull();
});
