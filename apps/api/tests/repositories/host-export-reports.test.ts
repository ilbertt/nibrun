import { afterAll, beforeAll, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import type { HostId } from '@repo/protocol';
import type { SQL } from 'bun';
import type { Queries } from '#db/queries.gen.ts';
import { ExportsRepository } from '#repositories/exports.repository.ts';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';
import { createDeployedApp } from '#tests/support/deployed-app.ts';
import { registerHost } from '#tests/support/hosts.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;
const RETENTION_MS = 86_400_000;
let HOST_ID: HostId;
let OTHER_HOST_ID: HostId;
let sql: SQL;

beforeAll(async function startDatabase() {
  sql = await startTestDatabase();
  HOST_ID = await registerHost({ sql, originId: 'export-host' });
  OTHER_HOST_ID = await registerHost({ sql, originId: 'other-host' });
}, DATABASE_START_TIMEOUT_MS);

afterAll(async function stopDatabase() {
  await stopTestDatabase(sql);
}, DATABASE_START_TIMEOUT_MS);

test('an export report can only be applied by the apps assigned host', async () => {
  const app = await createDeployedApp({ sql, name: 'export-owner' });
  await sql.unsafe('UPDATE nibrun.deployments SET host_id = $1 WHERE id = $2', [
    HOST_ID,
    app.deploymentId,
  ]);
  const repository = new ExportsRepository(withTypes<Queries>(sql));
  const bundle = await repository.request({
    appId: app.appId,
    ownerId: app.ownerId,
    expiresAt: new Date(Date.now() + RETENTION_MS),
  });
  expect(bundle).not.toBeNull();
  const reported = [
    {
      exportId: bundle!.id,
      state: 'ready' as const,
      checkpointId: null,
      sizeBytes: null,
      readyAt: new Date(),
      message: null,
    },
  ];
  await repository.applyReport({ reported, hostId: OTHER_HOST_ID });
  const [unchanged] = await sql.unsafe('SELECT state FROM nibrun.exports WHERE id = $1', [
    bundle!.id,
  ]);
  expect(unchanged.state).toBe('pending');
  await repository.applyReport({ reported, hostId: HOST_ID });
  const [updated] = await sql.unsafe('SELECT state FROM nibrun.exports WHERE id = $1', [
    bundle!.id,
  ]);
  expect(updated.state).toBe('ready');
});
