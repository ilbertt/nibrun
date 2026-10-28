import { afterAll, beforeAll, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import { type HostId, TimestampSchema } from '@repo/protocol';
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
const USAGE = {
  totalBytes: 8192,
  usedBytes: 4096,
  measuredAt: Value.Parse(TimestampSchema, '2026-10-28T10:00:00Z'),
};
let sql: SQL;

beforeAll(async function startDatabase() {
  sql = await startTestDatabase();
  HOST_ID = await registerHost({ sql, originId: 'owning-host' });
  OTHER_HOST_ID = await registerHost({ sql, originId: 'another-host' });
}, DATABASE_START_TIMEOUT_MS);

afterAll(async function stopDatabase() {
  await stopTestDatabase(sql);
}, DATABASE_START_TIMEOUT_MS);

async function hostedApp(name: string) {
  const app = await createDeployedApp({ sql, name });
  await sql.unsafe('UPDATE nibrun.deployments SET host_id = $1 WHERE id = $2', [
    HOST_ID,
    app.deploymentId,
  ]);
  return app;
}

test('a foreign host cannot measure or initialize another hosts volume', async () => {
  const app = await hostedApp('owned-volume-usage');
  const repository = new AppsRepository(withTypes<Queries>(sql));
  await repository.recordVolumeUsage({
    readings: new Map([[app.appId, USAGE]]),
    hostId: OTHER_HOST_ID,
  });
  await repository.stampDataInitialized({ appIds: [app.appId], hostId: OTHER_HOST_ID });
  expect(
    await sql.unsafe('SELECT * FROM nibrun.app_usage WHERE app_id = $1', [app.appId]),
  ).toHaveLength(0);
  const [uninitialized] = await sql.unsafe(
    'SELECT data_initialized_at FROM nibrun.apps WHERE id = $1',
    [app.appId],
  );
  expect(uninitialized.data_initialized_at).toBeNull();
  await repository.recordVolumeUsage({ readings: new Map([[app.appId, USAGE]]), hostId: HOST_ID });
  await repository.stampDataInitialized({ appIds: [app.appId], hostId: HOST_ID });
  const [initialized] = await sql.unsafe(
    'SELECT data_initialized_at FROM nibrun.apps WHERE id = $1',
    [app.appId],
  );
  expect(initialized.data_initialized_at).not.toBeNull();
  const [usage] = await sql.unsafe(
    'SELECT volume_used_bytes FROM nibrun.app_usage WHERE app_id = $1',
    [app.appId],
  );
  expect(Number(usage.volume_used_bytes)).toBe(USAGE.usedBytes);
});

test('only the owning host can acknowledge deletion of an apps volume', async () => {
  const app = await hostedApp('owned-volume-deletion');
  const repository = new AppsRepository(withTypes<Queries>(sql));
  await sql.unsafe("UPDATE nibrun.apps SET state = 'deleting' WHERE id = $1", [app.appId]);
  expect(await repository.finishDeletingVolume({ appId: app.appId, hostId: OTHER_HOST_ID })).toBe(
    false,
  );
  expect(await repository.finishDeleting({ appId: app.appId })).toBe(false);
  const [unchanged] = await sql.unsafe('SELECT state FROM nibrun.apps WHERE id = $1', [app.appId]);
  expect(unchanged.state).toBe('deleting');
  expect(await repository.finishDeletingVolume({ appId: app.appId, hostId: HOST_ID })).toBe(true);
});
