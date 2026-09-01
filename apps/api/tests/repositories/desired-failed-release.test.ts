import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;

const APP_SLUG = 'brittle';
const HOSTNAME = 'brittle.example.test';

type DesiredRow = { id: string; deployment_state: string };

/**
 * A release that did not come up used to leave desired state, and a host acts on that list by
 * forgetting everything not on it — hostnames included. So one microVM going down took the app
 * off the proxy entirely, which for a brought domain is a failed TLS handshake rather than any
 * answer at all. Only the real view can say whether it stays.
 */
describe('a release that failed is still one the host answers for', () => {
  let sql: SQL;

  beforeAll(async () => {
    sql = await startTestDatabase();
    await seedApp(sql);
  }, DATABASE_START_TIMEOUT_MS);

  afterAll(async () => {
    await stopTestDatabase(sql);
  }, DATABASE_START_TIMEOUT_MS);

  async function desired(): Promise<DesiredRow[]> {
    return (await sql.unsafe(
      'SELECT id, deployment_state FROM nibrun.desired_deployments',
    )) as DesiredRow[];
  }

  async function desiredHostnames(): Promise<string[]> {
    const rows = (await sql.unsafe('SELECT hostname FROM nibrun.desired_hostnames')) as {
      hostname: string;
    }[];
    return rows.map((row) => row.hostname);
  }

  test('the app is still there once its only release has failed', async () => {
    const first = await deploy({ sql, state: 'failed' });

    expect(await desired()).toEqual([{ id: first, deployment_state: 'failed' }]);
  });

  // The whole of the outage: the hostname is rendered from what the host is told to hold, so a
  // release leaving the list took the app's name off the proxy with it.
  test('and so is the hostname, which is what the visitor actually meets', async () => {
    expect(await desiredHostnames()).toEqual([HOSTNAME]);
  });

  /**
   * `supersedeLive` leaves a failed row alone, so an app that has been redeployed holds both.
   * Only one may reach the host: `hostnamesByApp` appends rather than dedupes, and the planner
   * keys on the app, so a second row is a duplicated site block and two plans for one microVM.
   */
  test('a live release supersedes nothing and still wins outright', async () => {
    const live = await deploy({ sql, state: 'running' });

    expect(await desired()).toEqual([{ id: live, deployment_state: 'running' }]);
    expect(await desiredHostnames()).toEqual([HOSTNAME]);
  });

  test('and when every release has failed, only the newest stands', async () => {
    await sql.unsafe(`UPDATE nibrun.deployments SET state = 'failed'`);
    const newest = await deploy({ sql, state: 'failed' });

    expect(await desired()).toEqual([{ id: newest, deployment_state: 'failed' }]);
  });

  // A deleted app is the one thing that does leave, because by then there is nothing to answer
  // for — which is the line this moves a failed release to the other side of.
  test('but a deleted app leaves however its last release ended', async () => {
    await sql.unsafe(`UPDATE nibrun.apps SET state = 'deleted' WHERE slug = $1`, [APP_SLUG]);

    expect(await desired()).toEqual([]);
    expect(await desiredHostnames()).toEqual([]);
  });
});

/** A release against the seeded app, in whatever state it ended in. Returns its id. */
async function deploy({ sql, state }: { sql: SQL; state: string }): Promise<string> {
  const [row] = (await sql.unsafe(
    `INSERT INTO nibrun.deployments (app_id, artifact_id, config_id, state)
     SELECT a.id, ar.id, c.id, $1
     FROM nibrun.apps a
     JOIN nibrun.artifacts ar ON ar.app_id = a.id
     JOIN nibrun.app_configs c ON c.app_id = a.id
     WHERE a.slug = $2
     RETURNING id`,
    [state, APP_SLUG],
  )) as { id: string }[];
  if (!row) {
    throw new Error('the release was not written');
  }
  return row.id;
}

/** An app with a hostname and something to deploy, but no release yet. */
async function seedApp(sql: SQL): Promise<void> {
  await sql.unsafe(
    `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ('owner', 'owner', 'owner@example.com', true, now(), now())`,
  );
  await sql.unsafe(`INSERT INTO nibrun.apps (owner_id, slug) VALUES ('owner', $1)`, [APP_SLUG]);
  await sql.unsafe(
    `INSERT INTO nibrun.app_hostnames (app_id, hostname, kind, state)
     SELECT id, $1, 'platform', 'active' FROM nibrun.apps WHERE slug = $2`,
    [HOSTNAME, APP_SLUG],
  );
  await sql.unsafe(
    `INSERT INTO nibrun.artifacts (app_id, digest, size_bytes, object_key, original_file_name)
     SELECT id, 'sha256:a', 1, 'artifacts/a', 'app' FROM nibrun.apps WHERE slug = $1`,
    [APP_SLUG],
  );
  await sql.unsafe(
    `INSERT INTO nibrun.app_configs (
       app_id, http_port, args, vcpu_count, memory_mib,
       health_check_interval_ms, health_check_timeout_ms, health_check_grace_period_ms,
       health_check_healthy_threshold, health_check_unhealthy_threshold,
       restart_max_restarts, restart_initial_backoff_ms, restart_max_backoff_ms,
       restart_backoff_factor, restart_reset_after_ms)
     SELECT id, 8080, '{}'::text[], 1, 512, 1000, 1000, 1000, 1, 3, 5, 500, 5000, 2, 60000
     FROM nibrun.apps WHERE slug = $1`,
    [APP_SLUG],
  );
}
