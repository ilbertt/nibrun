import { afterAll, beforeAll, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import type { AppAccessPolicy } from '@repo/protocol';
import { type HostId, Sha256DigestSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { SQL } from 'bun';
import type { Queries } from '#db/queries.gen.ts';
import { appAccess } from '#lib/app-access.ts';
import { sealSecret } from '#lib/tenant-secrets.ts';
import { AgentRepository } from '#repositories/agent.repository.ts';
import { AppsRepository } from '#repositories/apps.repository.ts';
import { DeploymentHostsRepository } from '#repositories/deployment-hosts.repository.ts';
import { DeploymentsRepository } from '#repositories/deployments.repository.ts';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';
import { createDeployedApp } from '#tests/support/deployed-app.ts';
import { registerHost, TEST_HOST_ID } from '#tests/support/hosts.ts';
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
  const app = await createDeployedApp({ sql, name, hostId: hostId });
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
    const desired = await repository().desiredState({ hostId, retainedDeploymentsPerApp: 2 });
    expect(desired.instances).toHaveLength(1);
    expect(desired.volumes).toHaveLength(1);
    expect(desired.instances[0]).toMatchObject({
      appId: app.appId,
      deploymentId: app.deploymentId,
      hostnames: [{ hostname: `${name}.apps.test`, kind: 'platform' }],
      config: { access: { kind: 'public' }, environment: { TOKEN: `${name}-secret` } },
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
  expect(
    await repository().desiredState({ hostId: STANDBY_HOST, retainedDeploymentsPerApp: 2 }),
  ).toEqual({
    hostId: STANDBY_HOST,
    retainedArtifactDigests: [],
    instances: [],
    volumes: [],
    checkpoints: [],
    exports: [],
  });
});

test('health reports leave the serialized desired state unchanged', async function stableDesiredState() {
  const hostId = await registerHost({ sql, originId: 'stable-order-host' });
  const apps = [];
  for (const name of ['ordering-first', 'ordering-second', 'ordering-third']) {
    apps.push(await createHostedApp({ name, hostId }));
  }
  const agent = repository();
  const before = JSON.stringify(await agent.desiredState({ hostId, retainedDeploymentsPerApp: 2 }));
  for (const app of apps) {
    await sql.unsafe('UPDATE nibrun.deployments SET last_healthy_at = now() WHERE id = $1', [
      app.deploymentId,
    ]);
    expect(JSON.stringify(await agent.desiredState({ hostId, retainedDeploymentsPerApp: 2 }))).toBe(
      before,
    );
  }
});

test('current execution lookup is scoped to the app owner', async () => {
  const hosts = new DeploymentHostsRepository(withTypes<Queries>(sql));
  expect(await hosts.currentForApp({ appId: source.appId, ownerId: source.ownerId })).toEqual({
    deployment_id: source.deploymentId,
    host_id: SOURCE_HOST,
  });
  expect(
    await hosts.currentForApp({ appId: source.appId, ownerId: destination.ownerId }),
  ).toBeNull();
  expect(
    await hosts.hostForExecution({ appId: source.appId, deploymentId: source.deploymentId }),
  ).toBe(SOURCE_HOST);
  expect(
    await hosts.hostForExecution({ appId: destination.appId, deploymentId: source.deploymentId }),
  ).toBeUndefined();
});

test('an execution assigned elsewhere is not offered to whichever host asks first', async () => {
  const elsewhere = await createDeployedApp({ sql, name: 'elsewhere-app', hostId: TEST_HOST_ID });
  for (const hostId of [SOURCE_HOST, DESTINATION_HOST, STANDBY_HOST]) {
    const desired = await repository().desiredState({ hostId, retainedDeploymentsPerApp: 2 });
    expect(desired.instances.some((instance) => instance.appId === elsewhere.appId)).toBe(false);
    expect(desired.volumes.some((volume) => volume.appId === elsewhere.appId)).toBe(false);
  }
});

test('failed and suspended apps retain their host and only that host can delete their volume', async () => {
  await sql.unsafe("UPDATE nibrun.apps SET state = 'suspended' WHERE id = $1", [source.appId]);
  await sql.unsafe("UPDATE nibrun.deployments SET state = 'failed' WHERE id = $1", [
    source.deploymentId,
  ]);
  expect(
    (await repository().desiredState({ hostId: SOURCE_HOST, retainedDeploymentsPerApp: 2 }))
      .instances[0],
  ).toMatchObject({
    appId: source.appId,
    desiredState: 'stopped',
  });
  await sql.unsafe("UPDATE nibrun.apps SET state = 'deleting' WHERE id = $1", [source.appId]);
  expect(
    (await repository().desiredState({ hostId: SOURCE_HOST, retainedDeploymentsPerApp: 2 }))
      .volumes[0],
  ).toMatchObject({
    appId: source.appId,
    desiredState: 'absent',
  });
  expect(
    (
      await repository().desiredState({ hostId: DESTINATION_HOST, retainedDeploymentsPerApp: 2 })
    ).volumes.some((volume) => volume.appId === source.appId),
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
  const oldHost = await repository().desiredState({
    hostId: SOURCE_HOST,
    retainedDeploymentsPerApp: 2,
  });
  expect(
    await new DeploymentHostsRepository(withTypes<Queries>(sql)).hostForExecution({
      appId: source.appId,
      deploymentId: source.deploymentId,
    }),
  ).toBeUndefined();
  expect(oldHost.instances).toEqual([]);
  expect(oldHost.volumes).toEqual([]);
  expect(oldHost.exports).toEqual([]);
  const newHost = await repository().desiredState({
    hostId: DESTINATION_HOST,
    retainedDeploymentsPerApp: 2,
  });
  expect(newHost.instances.map((instance) => instance.appId).sort()).toEqual(
    [source.appId, destination.appId].sort(),
  );
  expect(newHost.volumes.find((volume) => volume.appId === source.appId)?.desiredState).toBe(
    'present',
  );
  expect(newHost.exports.find((bundle) => bundle.appId === source.appId)).toBeDefined();
});

test('artifact retention follows the two latest executions of apps assigned to this host', async function retainsCurrentAndImmediatePredecessor() {
  const app = await createHostedApp({ name: 'cache-retention', hostId: SOURCE_HOST });
  const [uploaded] = await sql.unsafe('SELECT digest FROM nibrun.artifacts WHERE id = $1', [
    app.artifactId,
  ]);
  const digestLength = String(uploaded.digest).length;
  const oldest = Value.Parse(Sha256DigestSchema, '0'.repeat(digestLength));
  const previous = Value.Parse(Sha256DigestSchema, '1'.repeat(digestLength));
  const current = Value.Parse(Sha256DigestSchema, '2'.repeat(digestLength));
  await sql.unsafe('UPDATE nibrun.artifacts SET digest = $1 WHERE id = $2', [
    oldest,
    app.artifactId,
  ]);
  async function redeploy(digest: string) {
    await sql.begin(async function replaceExecution(tx) {
      await tx.unsafe(
        "UPDATE nibrun.deployments SET state = 'superseded' WHERE app_id = $1 AND state NOT IN ('superseded', 'failed')",
        [app.appId],
      );
      const [artifact] = await tx.unsafe(
        `INSERT INTO nibrun.artifacts (app_id, digest, size_bytes, object_key, original_file_name)
         VALUES ($1, $2, 1, $2, 'server') RETURNING id`,
        [app.appId, digest],
      );
      await tx.unsafe(
        `INSERT INTO nibrun.deployments (app_id, artifact_id, config_id, host_id, state)
         SELECT app_id, $1, config_id, host_id, 'running' FROM nibrun.deployments WHERE id = $2`,
        [artifact.id, app.deploymentId],
      );
    });
  }
  await redeploy(previous);
  await redeploy(current);
  const source = await repository().desiredState({
    hostId: SOURCE_HOST,
    retainedDeploymentsPerApp: 2,
  });
  expect(source.retainedArtifactDigests).toContain(previous);
  expect(source.retainedArtifactDigests).toContain(current);
  expect(source.retainedArtifactDigests).not.toContain(oldest);
  const elsewhere = await repository().desiredState({
    hostId: DESTINATION_HOST,
    retainedDeploymentsPerApp: 2,
  });
  expect(elsewhere.retainedArtifactDigests).not.toContain(previous);
  expect(elsewhere.retainedArtifactDigests).not.toContain(current);

  await redeploy(current);
  const repeated = await repository().desiredState({
    hostId: SOURCE_HOST,
    retainedDeploymentsPerApp: 2,
  });
  expect(repeated.retainedArtifactDigests).toContain(current);
  expect(repeated.retainedArtifactDigests).not.toContain(previous);

  const shared = await createHostedApp({ name: 'shared-cache-retention', hostId: SOURCE_HOST });
  await sql.unsafe('UPDATE nibrun.artifacts SET digest = $1 WHERE id = $2', [
    previous,
    shared.artifactId,
  ]);
  const sharing = await repository().desiredState({
    hostId: SOURCE_HOST,
    retainedDeploymentsPerApp: 2,
  });
  expect(sharing.retainedArtifactDigests).toContain(previous);
});

test('access edits are staged until deployed and rollback restores the pinned policy', async () => {
  const app = await createHostedApp({ name: 'protected-app', hostId: SOURCE_HOST });
  const apps = new AppsRepository(withTypes<Queries>(sql));
  const deployments = new DeploymentsRepository(withTypes<Queries>(sql));
  const jwt: AppAccessPolicy = {
    kind: 'jwt',
    issuer: 'my-issuer',
    audiences: ['first', 'second'],
    token: { header: 'X-Assertion', format: 'raw' },
    publicKeys: { url: 'https://issuer.example/jwks' },
  };

  async function deployedAccess() {
    const desired = await repository().desiredState({
      hostId: SOURCE_HOST,
      retainedDeploymentsPerApp: 2,
    });
    const instance = desired.instances.find((instance) => instance.appId === app.appId);
    expect(instance).not.toHaveProperty('access');
    return instance?.config.access;
  }

  async function deploy() {
    const result = await deployments.insert({
      client: 'cli',
      ...app,
      initialDataFrom: null,
      onlyOne: false,
    });
    if (result.outcome !== 'created') {
      throw new Error(result.outcome);
    }
    return result.row;
  }

  const publicAccess = { kind: 'public' } as const;
  const written = await apps.update({
    client: 'cli',
    ...app,
    patch: { name: undefined, access: jwt },
  });
  expect(written && appAccess(written)).toEqual(jwt);
  expect(await deployedAccess()).toEqual(publicAccess);
  const protectedDeployment = await deploy();
  expect(appAccess(protectedDeployment)).toEqual(jwt);
  expect(await deployedAccess()).toEqual(jwt);

  await apps.update({ client: 'cli', ...app, patch: { name: undefined, access: publicAccess } });
  expect(await deployedAccess()).toEqual(jwt);
  expect(appAccess(await deploy())).toEqual(publicAccess);
  expect(await deployedAccess()).toEqual(publicAccess);
  const historical = await deployments.findById({ ...app, deploymentId: protectedDeployment.id });
  expect(historical && appAccess(historical)).toEqual(jwt);

  const rollback = await deployments.insertRollback({
    client: 'cli',
    ...app,
    rollbackOf: protectedDeployment.id,
  });
  expect(rollback && appAccess(rollback)).toEqual(jwt);
  expect(await deployedAccess()).toEqual(jwt);
});
