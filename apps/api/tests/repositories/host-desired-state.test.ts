import { afterAll, beforeAll, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import type { HostId } from '@repo/protocol';
import type { SQL } from 'bun';
import type { Queries } from '#db/queries.gen.ts';
import { sealSecret } from '#lib/tenant-secrets.ts';
import { AgentRepository } from '#repositories/agent.repository.ts';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';
import { createDeployedApp } from '#tests/support/deployed-app.ts';
import { registerHost } from '#tests/support/hosts.ts';
import { TEST_SECRETS_KEY } from '#tests/support/secrets.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;
let SOURCE_HOST: HostId;
let DESTINATION_HOST: HostId;
let STANDBY_HOST: HostId;
let sql: SQL;
let source: Awaited<ReturnType<typeof createHostedApp>>;
let destination: Awaited<ReturnType<typeof createHostedApp>>;

beforeAll(async function startDatabase() {
  sql = await startTestDatabase();
  SOURCE_HOST = await registerHost({ sql, originId: 'source-host' });
  DESTINATION_HOST = await registerHost({ sql, originId: 'destination-host' });
  STANDBY_HOST = await registerHost({ sql, originId: 'standby-host' });
  source = await createHostedApp({ name: 'source-app', hostId: SOURCE_HOST });
  destination = await createHostedApp({ name: 'destination-app', hostId: DESTINATION_HOST });
}, DATABASE_START_TIMEOUT_MS);

afterAll(async function stopDatabase() {
  await stopTestDatabase(sql);
}, DATABASE_START_TIMEOUT_MS);

function repository() {
  return new AgentRepository({ sql: withTypes<Queries>(sql), secretsKey: TEST_SECRETS_KEY });
}

async function createHostedApp({ name, hostId }: { name: string; hostId: HostId }) {
  const app = await createDeployedApp({ sql, name });
  await sql.unsafe('UPDATE nibrun.deployments SET host_id = $1 WHERE id = $2', [
    hostId,
    app.deploymentId,
  ]);
  await sql.unsafe(
    `INSERT INTO nibrun.app_hostnames (app_id, hostname, kind, state)
     VALUES ($1, $2, 'platform', 'active')`,
    [app.appId, `${name}.apps.test`],
  );
  await sql.unsafe(
    `INSERT INTO nibrun.app_config_environment (config_id, name, value)
     SELECT config_id, 'TOKEN', $1 FROM nibrun.deployments WHERE id = $2`,
    [sealSecret({ key: TEST_SECRETS_KEY, plaintext: `${name}-secret` }), app.deploymentId],
  );
  await sql.unsafe(
    `INSERT INTO nibrun.exports (app_id, artifact_id, config_id, expires_at)
     SELECT app_id, artifact_id, config_id, now() + interval '1 day'
     FROM nibrun.deployments WHERE id = $1`,
    [app.deploymentId],
  );
  return app;
}

test('hosts receive only their own executions, volumes, hostnames and decrypted environment', async () => {
  for (const [hostId, app, name] of [
    [SOURCE_HOST, source, 'source-app'],
    [DESTINATION_HOST, destination, 'destination-app'],
  ] as const) {
    const desired = await repository().desiredState({ hostId });
    expect(desired.instances).toHaveLength(1);
    expect(desired.volumes).toHaveLength(1);
    expect(desired.instances[0]).toMatchObject({
      appId: app.appId,
      deploymentId: app.deploymentId,
      hostnames: [{ hostname: `${name}.apps.test`, kind: 'platform' }],
      config: { environment: { TOKEN: `${name}-secret` } },
    });
    expect(desired.volumes[0]?.appId).toBe(app.appId);
    expect(desired.exports).toHaveLength(1);
    expect(desired.exports[0]).toMatchObject({
      appId: app.appId,
      environment: { TOKEN: `${name}-secret` },
    });
  }
});

test('a standby host receives no apps, volumes or exports', async () => {
  expect(await repository().desiredState({ hostId: STANDBY_HOST })).toEqual({
    hostId: STANDBY_HOST,
    instances: [],
    volumes: [],
    checkpoints: [],
    exports: [],
  });
});

test('an unplaced execution is not offered to whichever host asks first', async () => {
  const unplaced = await createDeployedApp({ sql, name: 'unplaced-app' });
  for (const hostId of [SOURCE_HOST, DESTINATION_HOST, STANDBY_HOST]) {
    const desired = await repository().desiredState({ hostId });
    expect(desired.instances.some((instance) => instance.appId === unplaced.appId)).toBe(false);
    expect(desired.volumes.some((volume) => volume.appId === unplaced.appId)).toBe(false);
  }
});

test('failed and suspended apps retain their host and only that host can delete their volume', async () => {
  await sql.unsafe("UPDATE nibrun.apps SET state = 'suspended' WHERE id = $1", [source.appId]);
  await sql.unsafe("UPDATE nibrun.deployments SET state = 'failed' WHERE id = $1", [
    source.deploymentId,
  ]);
  expect((await repository().desiredState({ hostId: SOURCE_HOST })).instances[0]).toMatchObject({
    appId: source.appId,
    desiredState: 'stopped',
  });
  await sql.unsafe("UPDATE nibrun.apps SET state = 'deleting' WHERE id = $1", [source.appId]);
  expect((await repository().desiredState({ hostId: SOURCE_HOST })).volumes[0]).toMatchObject({
    appId: source.appId,
    desiredState: 'absent',
  });
  expect(
    (await repository().desiredState({ hostId: DESTINATION_HOST })).volumes.some(
      (volume) => volume.appId === source.appId,
    ),
  ).toBe(false);
});

test('a new execution transfers all desired work without deleting the source volume', async () => {
  await sql.begin(async function handoff(tx) {
    await tx.unsafe("UPDATE nibrun.apps SET state = 'active' WHERE id = $1", [source.appId]);
    await tx.unsafe("UPDATE nibrun.deployments SET state = 'superseded' WHERE id = $1", [
      source.deploymentId,
    ]);
    await tx.unsafe(
      `INSERT INTO nibrun.deployments (app_id, artifact_id, config_id, host_id)
       SELECT app_id, artifact_id, config_id, $1 FROM nibrun.deployments WHERE id = $2`,
      [DESTINATION_HOST, source.deploymentId],
    );
  });
  const oldHost = await repository().desiredState({ hostId: SOURCE_HOST });
  expect(oldHost.instances).toEqual([]);
  expect(oldHost.volumes).toEqual([]);
  expect(oldHost.exports).toEqual([]);
  const newHost = await repository().desiredState({ hostId: DESTINATION_HOST });
  expect(newHost.instances.map((instance) => instance.appId).sort()).toEqual(
    [source.appId, destination.appId].sort(),
  );
  expect(newHost.volumes.find((volume) => volume.appId === source.appId)?.desiredState).toBe(
    'present',
  );
  expect(newHost.exports.find((bundle) => bundle.appId === source.appId)).toBeDefined();
});
