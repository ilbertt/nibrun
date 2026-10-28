import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import { HOST_STATES, type HostId, HostReportedStateSchema, type HostState } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { SQL } from 'bun';
import { type Queries, schema } from '#db/queries.gen.ts';
import { HOST_REPORT_MAX_AGE_MS } from '#lib/host-readiness.ts';
import { AgentRepository } from '#repositories/agent.repository.ts';
import { DeploymentsRepository } from '#repositories/deployments.repository.ts';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';
import { createDeployedApp } from '#tests/support/deployed-app.ts';
import { registerHost, TEST_HOST_ID } from '#tests/support/hosts.ts';
import { TEST_SECRETS_KEY } from '#tests/support/secrets.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;
let sql: SQL;

beforeAll(async () => {
  sql = await startTestDatabase();
}, DATABASE_START_TIMEOUT_MS);
afterAll(async () => {
  await stopTestDatabase(sql);
}, DATABASE_START_TIMEOUT_MS);
beforeEach(async () => {
  await sql.unsafe('UPDATE nibrun.hosts SET last_seen_at = NULL');
});

function repository() {
  return new DeploymentsRepository(withTypes<Queries>(sql));
}

function report({ hostId, state }: { hostId: HostId; state: HostState }) {
  const capacity = { vcpuCount: 2, memoryMib: 8192, cacheBytes: 100 };
  return Value.Parse(HostReportedStateSchema, {
    hostId,
    state,
    reportedAt: new Date().toISOString(),
    capacity,
    allocatable: capacity,
    versions: { agent: 'a', guestImage: 'b', zerofs: 'c', firecracker: 'd' },
    instances: [],
    volumes: [],
    checkpoints: [],
    exports: [],
  });
}

async function availableHost() {
  const hostId = await registerHost({ sql, originId: crypto.randomUUID() });
  const agent = new AgentRepository({ sql: withTypes<Queries>(sql), secretsKey: TEST_SECRETS_KEY });
  await agent.observeReport({ reported: report({ hostId, state: 'ready' }) });
  return hostId;
}

async function newApp(name: string) {
  const app = await createDeployedApp({ sql, name, hostId: TEST_HOST_ID });
  await sql.unsafe('DELETE FROM nibrun.deployments WHERE id = $1', [app.deploymentId]);
  return app;
}

function deploy(app: Awaited<ReturnType<typeof createDeployedApp>>) {
  return repository().insert({
    appId: app.appId,
    ownerId: app.ownerId,
    artifactId: app.artifactId,
    initialDataFrom: null,
    onlyOne: false,
  });
}

test('the database rejects unknown reported host states', async () => {
  const hostId = await registerHost({ sql, originId: 'invalid-reported-state-host' });
  await expect(
    sql.unsafe("UPDATE nibrun.hosts SET reported_state = 'invalid' WHERE id = $1", [hostId]),
  ).rejects.toMatchObject({
    errno: '23514',
    constraint: schema.hosts._constraints.hosts_reported_state_check._constraintName,
  });
});

test('a host becomes eligible only after reporting ready and is assigned in the first deployment', async () => {
  const hostId = await registerHost({ sql, originId: 'reporting-ready-host' });
  const app = await newApp('ready-placement');
  expect(await deploy(app)).toEqual({ outcome: 'no-host' });
  const agent = new AgentRepository({ sql: withTypes<Queries>(sql), secretsKey: TEST_SECRETS_KEY });
  await agent.observeReport({ reported: report({ hostId, state: 'ready' }) });
  const placed = await deploy(app);
  expect(placed.outcome).toBe('created');
  const [row] = await sql.unsafe('SELECT host_id FROM nibrun.deployments WHERE app_id = $1', [
    app.appId,
  ]);
  expect(row.host_id).toBe(hostId);
  await agent.observeReport({ reported: report({ hostId, state: 'registering' }) });
  const [host] = await sql.unsafe(
    'SELECT reported_state, last_seen_at FROM nibrun.hosts WHERE id = $1',
    [hostId],
  );
  expect(host.reported_state).toBe('registering');
  expect(host.last_seen_at).toBeInstanceOf(Date);
});

test.each(HOST_STATES.filter((state) => state !== 'ready'))(
  '%s hosts cannot receive a new app',
  async (state) => {
    const hostId = await availableHost();
    const agent = new AgentRepository({
      sql: withTypes<Queries>(sql),
      secretsKey: TEST_SECRETS_KEY,
    });
    await agent.observeReport({ reported: report({ hostId, state }) });
    const [host] = await sql.unsafe('SELECT reported_state FROM nibrun.hosts WHERE id = $1', [
      hostId,
    ]);
    expect(host.reported_state).toBe(state);
    const app = await newApp(`reject-${state}`);
    expect(await deploy(app)).toEqual({ outcome: 'no-host' });
    const [row] = await sql.unsafe(
      'SELECT count(*)::integer AS count FROM nibrun.deployments WHERE app_id = $1',
      [app.appId],
    );
    expect(row.count).toBe(0);
  },
);

test('a ready host with a stale report cannot receive a new app', async () => {
  const hostId = await availableHost();
  await sql.unsafe(
    "UPDATE nibrun.hosts SET last_seen_at = now() - $2 * interval '1 millisecond' WHERE id = $1",
    [hostId, HOST_REPORT_MAX_AGE_MS * 2],
  );
  expect(await deploy(await newApp('reject-stale'))).toEqual({ outcome: 'no-host' });
});

test('a redeploy retains its current host even when only a different host is ready', async () => {
  const hostId = await registerHost({ sql, originId: 'retained-host' });
  const app = await createDeployedApp({ sql, name: 'retained-placement', hostId });
  await sql.unsafe('UPDATE nibrun.deployments SET host_id = $1 WHERE id = $2', [
    hostId,
    app.deploymentId,
  ]);
  await availableHost();
  expect((await deploy(app)).outcome).toBe('created');
  const rows = await sql.unsafe('SELECT host_id FROM nibrun.deployments WHERE app_id = $1', [
    app.appId,
  ]);
  for (const row of rows) {
    expect(row.host_id).toBe(hostId);
  }
});
