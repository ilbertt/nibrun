import { afterAll, beforeAll, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import type { DeploymentId, HostId } from '@repo/protocol';
import type { SQL } from 'bun';
import type { Queries } from '#db/queries.gen.ts';
import {
  DeploymentsRepository,
  type ReportedDeployment,
} from '#repositories/deployments.repository.ts';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';
import { createDeployedApp } from '#tests/support/deployed-app.ts';
import { registerHost } from '#tests/support/hosts.ts';
import { refusedBy } from '#tests/support/postgres.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;
let sql: SQL;
let HOST_ID: HostId;
let OTHER_HOST_ID: HostId;
let DESTINATION_HOST_ID: HostId;

beforeAll(async function startDatabase() {
  sql = await startTestDatabase();
  HOST_ID = await registerHost({ sql, originId: 'original-host' });
  OTHER_HOST_ID = await registerHost({ sql, originId: 'another-host' });
  DESTINATION_HOST_ID = await registerHost({ sql, originId: 'destination-host' });
}, DATABASE_START_TIMEOUT_MS);

afterAll(async function stopDatabase() {
  await stopTestDatabase(sql);
}, DATABASE_START_TIMEOUT_MS);

test('an existing deployment can be adopted once without changing its execution', async () => {
  const { deploymentId } = await createDeployedApp({ sql, name: 'adopt-host' });
  const [before] = await sql.unsafe('SELECT * FROM nibrun.deployments WHERE id = $1', [
    deploymentId,
  ]);
  expect(before.host_id).toBeNull();
  await sql.unsafe('UPDATE nibrun.deployments SET host_id = $1 WHERE id = $2', [
    HOST_ID,
    deploymentId,
  ]);
  const [after] = await sql.unsafe('SELECT * FROM nibrun.deployments WHERE id = $1', [
    deploymentId,
  ]);
  expect(after).toMatchObject({
    ...before,
    host_id: HOST_ID,
    updated_at: after.updated_at,
  });
});

test('moving or clearing an assigned host requires a new deployment', async () => {
  const { deploymentId } = await createDeployedApp({ sql, name: 'fixed-host' });
  await sql.unsafe('UPDATE nibrun.deployments SET host_id = $1 WHERE id = $2', [
    HOST_ID,
    deploymentId,
  ]);
  for (const hostId of [OTHER_HOST_ID, null]) {
    expect(
      await refusedBy(async function changeHost() {
        await sql.unsafe('UPDATE nibrun.deployments SET host_id = $1 WHERE id = $2', [
          hostId,
          deploymentId,
        ]);
      }),
    ).toBe('deployments_host_immutable');
  }
  await sql.unsafe('UPDATE nibrun.deployments SET host_id = $1 WHERE id = $2', [
    HOST_ID,
    deploymentId,
  ]);
});

test('an execution cannot be assigned to an unregistered host', async () => {
  const { deploymentId } = await createDeployedApp({ sql, name: 'unknown-host' });
  expect(
    await refusedBy(async function assignUnknownHost() {
      await sql.unsafe('UPDATE nibrun.deployments SET host_id = $1 WHERE id = $2', [
        Bun.randomUUIDv7(),
        deploymentId,
      ]);
    }),
  ).toBe('deployments_host_id_fkey');
});

test('a referenced host cannot be deleted', async () => {
  const { deploymentId } = await createDeployedApp({ sql, name: 'retained-host' });
  await sql.unsafe('UPDATE nibrun.deployments SET host_id = $1 WHERE id = $2', [
    HOST_ID,
    deploymentId,
  ]);
  expect(
    await refusedBy(async function deleteReferencedHost() {
      await sql.unsafe('DELETE FROM nibrun.hosts WHERE id = $1', [HOST_ID]);
    }),
  ).toBe('deployments_host_id_fkey');
});

test('registration preserves a UUIDv7 identity across renewals and API restarts', async () => {
  const originId = crypto.randomUUID();
  const hostId = await registerHost({ sql, originId });
  const [registered] = await sql.unsafe(
    'SELECT *, uuid_extract_version(id) AS version FROM nibrun.hosts WHERE id = $1',
    [hostId],
  );
  expect(registered).toMatchObject({ id: hostId, origin_id: originId, version: 7 });
  expect(registered.created_at).toBeInstanceOf(Date);
  expect(await registerHost({ sql, originId })).toBe(hostId);
  expect(await registerHost({ sql, originId: hostId })).toBe(hostId);
  const [count] = await sql.unsafe(
    'SELECT count(*)::integer AS count FROM nibrun.hosts WHERE origin_id = $1',
    [originId],
  );
  expect(count.count).toBe(1);
});

test('concurrent registrations share one origin and canonical identity', async () => {
  const originId = 'concurrent-origin';
  const [first, second] = await Promise.all([
    registerHost({ sql, originId }),
    registerHost({ sql, originId }),
  ]);
  expect(first).toBe(second);
  const rows = await sql.unsafe('SELECT id FROM nibrun.hosts WHERE origin_id = $1', [originId]);
  expect([...rows]).toEqual([{ id: first }]);
});

test('a redeploy inherits the previous execution host', async () => {
  const app = await createDeployedApp({ sql, name: 'redeploy-host' });
  await sql.unsafe('UPDATE nibrun.deployments SET host_id = $1 WHERE id = $2', [
    HOST_ID,
    app.deploymentId,
  ]);
  const deployed = await new DeploymentsRepository(withTypes<Queries>(sql)).insert({
    appId: app.appId,
    ownerId: app.ownerId,
    artifactId: app.artifactId,
    initialDataFrom: null,
    onlyOne: false,
  });
  expect(deployed.outcome).toBe('created');
  const [current] = await sql.unsafe(
    'SELECT host_id FROM nibrun.deployments WHERE app_id = $1 ORDER BY id DESC LIMIT 1',
    [app.appId],
  );
  expect(current.host_id).toBe(HOST_ID);
});

test('an artifact rollback keeps the current host rather than replaying the original host', async () => {
  const app = await createDeployedApp({ sql, name: 'rollback-host' });
  await sql.unsafe('UPDATE nibrun.deployments SET host_id = $1, state = $2 WHERE id = $3', [
    HOST_ID,
    'superseded',
    app.deploymentId,
  ]);
  await sql.unsafe(
    `INSERT INTO nibrun.deployments (app_id, artifact_id, config_id, host_id)
     SELECT app_id, artifact_id, config_id, $1 FROM nibrun.deployments WHERE id = $2`,
    [DESTINATION_HOST_ID, app.deploymentId],
  );
  const replayed = await new DeploymentsRepository(withTypes<Queries>(sql)).insertRollback({
    appId: app.appId,
    ownerId: app.ownerId,
    rollbackOf: app.deploymentId,
  });
  expect(replayed).not.toBeNull();
  const [current] = await sql.unsafe('SELECT host_id FROM nibrun.deployments WHERE id = $1', [
    replayed!.id,
  ]);
  expect(current.host_id).toBe(DESTINATION_HOST_ID);
});

test('a host lifecycle pass cannot inspect deployments assigned to another host', async () => {
  const app = await createDeployedApp({ sql, name: 'scoped-live-host' });
  await sql.unsafe('UPDATE nibrun.deployments SET host_id = $1 WHERE id = $2', [
    HOST_ID,
    app.deploymentId,
  ]);
  const repository = new DeploymentsRepository(withTypes<Queries>(sql));
  expect(await repository.listLive({ hostId: HOST_ID })).toContainEqual(
    expect.objectContaining({ id: app.deploymentId }),
  );
  expect(await repository.listLive({ hostId: OTHER_HOST_ID })).not.toContainEqual(
    expect.objectContaining({ id: app.deploymentId }),
  );
});

test('a foreign host cannot report, activate or fail an assigned deployment', async () => {
  const app = await createDeployedApp({ sql, name: 'scoped-write-host' });
  await sql.unsafe('UPDATE nibrun.deployments SET host_id = $1 WHERE id = $2', [
    HOST_ID,
    app.deploymentId,
  ]);
  const repository = new DeploymentsRepository(withTypes<Queries>(sql));
  const [before] = await sql.unsafe('SELECT * FROM nibrun.deployments WHERE id = $1', [
    app.deploymentId,
  ]);
  await repository.applyReport({
    reported: [deploymentReport(app.deploymentId)],
    hostId: OTHER_HOST_ID,
  });
  await repository.stampActivation({
    deploymentId: app.deploymentId,
    at: new Date(),
    hostId: OTHER_HOST_ID,
  });
  await repository.fail({
    deploymentId: app.deploymentId,
    message: 'A different host did not start it.',
    hostId: OTHER_HOST_ID,
  });
  const [unchanged] = await sql.unsafe('SELECT * FROM nibrun.deployments WHERE id = $1', [
    app.deploymentId,
  ]);
  expect(unchanged).toEqual(before);
  await repository.applyReport({ reported: [deploymentReport(app.deploymentId)], hostId: HOST_ID });
  const [updated] = await sql.unsafe('SELECT restart_count FROM nibrun.deployments WHERE id = $1', [
    app.deploymentId,
  ]);
  expect(updated.restart_count).toBe(1);
});

function deploymentReport(deploymentId: DeploymentId): ReportedDeployment {
  return {
    deploymentId,
    state: 'running',
    instanceState: 'running',
    hostPort: null,
    guestIpv4: null,
    publicIpv4: null,
    extraPublicPort: null,
    restartCount: 1,
    message: null,
    startedAt: null,
    lastHealthyAt: null,
  };
}
