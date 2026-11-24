import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import {
  type DeploymentId,
  type HostId,
  HostReportedStateSchema,
  SecretStringSchema,
} from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { SQL } from 'bun';
import { type Queries, schema } from '#db/queries.gen.ts';
import { OperationClient } from '#lib/operation-client.ts';
import { AgentRepository } from '#repositories/agent.repository.ts';
import { DeploymentsRepository } from '#repositories/deployments.repository.ts';
import { HealthService } from '#services/health.service.ts';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';
import { createDeployedApp } from '#tests/support/deployed-app.ts';
import { hostReport, registerHost, TEST_HOST_ID } from '#tests/support/hosts.ts';
import { refusedBy } from '#tests/support/postgres.ts';
import { TEST_SECRETS_KEY } from '#tests/support/secrets.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;
const SESSION_LIFETIME_MS = 60_000;
let sql: SQL;

beforeAll(async function startDatabase() {
  sql = await startTestDatabase();
}, DATABASE_START_TIMEOUT_MS);

afterAll(async function stopDatabase() {
  await stopTestDatabase(sql);
}, DATABASE_START_TIMEOUT_MS);

beforeEach(async function clearReadiness() {
  await sql.unsafe('UPDATE nibrun.hosts SET last_seen_at = NULL');
});

function agentRepository() {
  return new AgentRepository({ sql: withTypes<Queries>(sql), secretsKey: TEST_SECRETS_KEY });
}

function deploymentsRepository() {
  return new DeploymentsRepository(withTypes<Queries>(sql));
}

async function readyHost() {
  const hostId = await registerHost({ sql, originId: crypto.randomUUID() });
  await agentRepository().observeReport({ reported: hostReport({ hostId, state: 'ready' }) });
  return hostId;
}

async function retire(hostId: HostId) {
  await sql.unsafe('UPDATE nibrun.hosts SET retired_at = now() WHERE id = $1', [hostId]);
}

function deploy(app: Awaited<ReturnType<typeof createDeployedApp>>) {
  return deploymentsRepository().insert({
    client: OperationClient.Cli,
    appId: app.appId,
    ownerId: app.ownerId,
    artifactId: app.artifactId,
    initialDataFrom: null,
    onlyOne: false,
  });
}

async function insertAssignedDeployment({
  connection,
  deploymentId,
  hostId,
}: {
  connection: Pick<SQL, 'unsafe'>;
  deploymentId: DeploymentId;
  hostId: HostId;
}) {
  await connection.unsafe(
    `INSERT INTO nibrun.deployments (app_id, artifact_id, config_id, state, host_id)
     SELECT app_id, artifact_id, config_id, 'failed', $2
     FROM nibrun.deployments WHERE id = $1`,
    [deploymentId, hostId],
  );
}

test('agents cannot report retirement as a health state', () => {
  expect(
    Value.Check(HostReportedStateSchema, {
      ...hostReport({ hostId: TEST_HOST_ID, state: 'ready' }),
      state: 'retired',
    }),
  ).toBe(false);
});

test('retirement preserves reported health and excludes the host from status checks', async () => {
  const hostId = await readyHost();
  const agent = agentRepository();
  const reported = hostReport({ hostId, state: 'ready' });
  expect(await agent.observeReport({ reported })).toBe(true);
  await retire(hostId);
  const [retired] = await sql.unsafe(
    'SELECT reported_state, retired_at, last_seen_at FROM nibrun.hosts WHERE id = $1',
    [hostId],
  );
  expect(retired).toMatchObject({ reported_state: 'ready' });
  expect(retired.retired_at).toBeInstanceOf(Date);
  expect(await agent.observeReport({ reported: { ...reported, state: 'draining' } })).toBe(false);
  const [unchanged] = await sql.unsafe(
    'SELECT reported_state, retired_at, last_seen_at FROM nibrun.hosts WHERE id = $1',
    [hostId],
  );
  expect(unchanged).toEqual(retired);
  expect(await agent.lastObservation()).toBeUndefined();
});

test('retirement timestamps are finite and cannot be changed or cleared', async () => {
  const hostId = await readyHost();
  expect(
    await refusedBy(async function retireAtInfinity() {
      await sql.unsafe("UPDATE nibrun.hosts SET retired_at = 'infinity' WHERE id = $1", [hostId]);
    }),
  ).toBe(schema.hosts._constraints.hosts_retired_at_finite._constraintName);
  await retire(hostId);
  for (const value of [null, new Date('2026-01-01T00:00:00Z')]) {
    await expect(
      (async function changeRetirement() {
        await sql.unsafe('UPDATE nibrun.hosts SET retired_at = $2 WHERE id = $1', [hostId, value]);
      })(),
    ).rejects.toMatchObject({ errno: '23514' });
  }
  await sql.unsafe('UPDATE nibrun.hosts SET retired_at = retired_at WHERE id = $1', [hostId]);
  expect([
    ...(await sql.unsafe('SELECT action, client FROM nibrun.operations WHERE host_id = $1', [
      hostId,
    ])),
  ]).toEqual([{ action: 'host.retired', client: 'system' }]);
});

test('retired origin and canonical identities cannot re-register or receive sessions', async () => {
  const originId = crypto.randomUUID();
  const hostId = await registerHost({ sql, originId });
  const agent = agentRepository();
  const sessionToken = Value.Parse(SecretStringSchema, crypto.randomUUID());
  const session = { hostId, sessionToken, expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS) };
  expect(await agent.saveSession(session)).toBe(true);
  expect(await agent.hostForSession({ sessionToken })).toBe(hostId);
  await retire(hostId);
  expect(await agent.hostForIdentity({ identity: originId })).toBe(hostId);
  expect(await agent.registerHost({ originId })).toBeUndefined();
  expect(await agent.registerHost({ originId: hostId })).toBeUndefined();
  expect(await agent.registerHost({ originId: hostId.toUpperCase() })).toBeUndefined();
  expect(await agent.saveSession(session)).toBe(false);
  expect(await agent.hostForSession({ sessionToken })).toBeUndefined();
  const [count] = await sql.unsafe(
    'SELECT count(*)::integer AS count FROM nibrun.hosts WHERE origin_id = $1 OR id = $2',
    [originId, hostId],
  );
  expect(count.count).toBe(1);
});

test('a freshly ready retired host is never selected for a new app', async () => {
  const hostId = await readyHost();
  await retire(hostId);
  const app = await createDeployedApp({ sql, name: 'retired-placement', hostId: TEST_HOST_ID });
  await sql.unsafe('DELETE FROM nibrun.deployments WHERE id = $1', [app.deploymentId]);
  expect(await deploy(app)).toEqual({ outcome: 'no-host' });
  const active = await readyHost();
  const result = await deploy(app);
  expect(result.outcome).toBe('created');
  const [assigned] = await sql.unsafe('SELECT host_id FROM nibrun.app_hosts WHERE app_id = $1', [
    app.appId,
  ]);
  expect(assigned.host_id).toBe(active);
});

test('redeploys and rollbacks on a retired host fail without relocating or superseding history', async () => {
  const hostId = await readyHost();
  const app = await createDeployedApp({ sql, name: 'retired-sticky-host', hostId });
  await readyHost();
  await retire(hostId);
  expect(await deploy(app)).toEqual({ outcome: 'no-host' });
  expect(
    await deploymentsRepository().insertRollback({
      client: OperationClient.Cli,
      appId: app.appId,
      ownerId: app.ownerId,
      rollbackOf: app.deploymentId,
    }),
  ).toBeNull();
  const rows = await sql.unsafe(
    'SELECT id, host_id, state FROM nibrun.deployments WHERE app_id = $1',
    [app.appId],
  );
  expect([...rows]).toEqual([{ id: app.deploymentId, host_id: hostId, state: 'running' }]);
  expect(
    await refusedBy(async function deleteHistoricalHost() {
      await sql.unsafe('DELETE FROM nibrun.hosts WHERE id = $1', [hostId]);
    }),
  ).toBe(schema.deployments._constraints.deployments_host_id_fkey._constraintName);
});

test('database admission serializes with retirement and refuses direct assignment afterwards', async () => {
  const hostId = await readyHost();
  const app = await createDeployedApp({ sql, name: 'retirement-race', hostId });
  const held = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const retiring = sql.begin(async function holdRetirement(tx) {
    await tx.unsafe('UPDATE nibrun.hosts SET retired_at = now() WHERE id = $1', [hostId]);
    held.resolve();
    await release.promise;
  });
  try {
    await held.promise;
    await expect(
      sql.begin(async function assignWhileRetiring(tx) {
        await tx.unsafe("SET LOCAL lock_timeout = '200ms'");
        await insertAssignedDeployment({ connection: tx, deploymentId: app.deploymentId, hostId });
      }),
    ).rejects.toMatchObject({ errno: '55P03' });
  } finally {
    release.resolve();
    await retiring;
  }
  await expect(
    insertAssignedDeployment({ connection: sql, deploymentId: app.deploymentId, hostId }),
  ).rejects.toMatchObject({ errno: '23514' });
});

test('dashboard status ignores the latest retired reporter and uses the remaining active host', async () => {
  const active = await readyHost();
  const retiring = await readyHost();
  const agent = agentRepository();
  const health = new HealthService({
    agentRepo: agent,
    healthRepo: {
      pingDatabase() {
        return Promise.resolve();
      },
      pingLogStore() {
        return Promise.resolve();
      },
      pingObjectStore() {
        return Promise.resolve();
      },
    },
  });
  expect((await agent.lastObservation())?.hostId).toBe(retiring);
  await retire(retiring);
  expect(await agent.lastObservation()).toMatchObject({ hostId: active, state: 'ready' });
  expect((await health.check()).components.appHost).toEqual({ status: 'up' });
  await retire(active);
  expect(await agent.lastObservation()).toBeUndefined();
  const status = await health.check();
  expect(status.components.agent.status).toBe('down');
  expect(status.components.appHost.status).toBe('unknown');
});
