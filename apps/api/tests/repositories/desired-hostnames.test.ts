import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;

const APP_SLUG = 'routing';
const PLATFORM = 'routing.apps.example.com';
const BROUGHT = 'brought.example.dev';

/**
 * `nibrun.desired_hostnames` is the whole of what a host renders its proxy config from, and its
 * `state` filter is the only thing standing between a hostname nobody has proved they own and the
 * fleet answering for it. That filter is SQL, so no test over a fake repository can reach it —
 * this is the one place it is exercised.
 */
describe('a hostname is routed once it has earned it', () => {
  let sql: SQL;

  // Long enough to pull the image, which the first run on a fresh machine does inside this hook.
  // Bun's default is five seconds, and a pull is not something a timeout should be racing.
  beforeAll(async () => {
    sql = await startTestDatabase();
    await seedDeployedApp(sql);
  }, DATABASE_START_TIMEOUT_MS);

  afterAll(async () => {
    await stopTestDatabase(sql);
  }, DATABASE_START_TIMEOUT_MS);

  async function routedHostnames(): Promise<string[]> {
    const rows = (await sql.unsafe(
      'SELECT hostname FROM nibrun.desired_hostnames ORDER BY hostname',
    )) as Array<{ hostname: string }>;
    return rows.map((row) => row.hostname);
  }

  // Nothing waits for a name the wildcard record and the wildcard certificate already cover.
  test('the hostname nibrun issued is routable the moment the app exists', async () => {
    expect(await routedHostnames()).toEqual([PLATFORM]);
  });

  test('a brought domain is not, until its owner has pointed DNS at us', async () => {
    await sql.unsafe(
      `INSERT INTO nibrun.app_hostnames (app_id, hostname, kind)
       SELECT id, $1, 'custom' FROM nibrun.apps WHERE slug = $2`,
      [BROUGHT, APP_SLUG],
    );

    expect(await routedHostnames()).toEqual([PLATFORM]);
  });

  test('and is routable once it is', async () => {
    await sql.unsafe('UPDATE nibrun.app_hostnames SET state = $1 WHERE hostname = $2', [
      'active',
      BROUGHT,
    ]);

    expect(await routedHostnames()).toEqual([BROUGHT, PLATFORM]);
  });

  // A claim that lapsed is a name the fleet has to stop answering for, not one it keeps serving
  // because it once did.
  test('and stops being routable if the claim is given up', async () => {
    await sql.unsafe('UPDATE nibrun.app_hostnames SET state = $1 WHERE hostname = $2', [
      'failed',
      BROUGHT,
    ]);

    expect(await routedHostnames()).toEqual([PLATFORM]);
  });
});

/** An app a host would be told to run: one live deployment, one platform hostname. */
async function seedDeployedApp(sql: SQL): Promise<void> {
  await sql.unsafe(
    `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ('owner', 'owner', 'owner@example.com', true, now(), now())`,
  );
  await sql.unsafe(`INSERT INTO nibrun.apps (owner_id, slug) VALUES ('owner', $1)`, [APP_SLUG]);
  await sql.unsafe(
    `INSERT INTO nibrun.app_hostnames (app_id, hostname, kind, state)
     SELECT id, $1, 'platform', 'active' FROM nibrun.apps WHERE slug = $2`,
    [PLATFORM, APP_SLUG],
  );
  await sql.unsafe(
    `INSERT INTO nibrun.artifacts (app_id, digest, size_bytes, object_key, original_file_name)
     SELECT id, 'sha256:a', 1, 'artifacts/a', 'app' FROM nibrun.apps WHERE slug = $1`,
    [APP_SLUG],
  );
  await sql.unsafe(
    `INSERT INTO nibrun.app_configs (
       app_id, guest_port, args, vcpu_count, memory_mib,
       health_check_interval_ms, health_check_timeout_ms, health_check_grace_period_ms,
       health_check_healthy_threshold, health_check_unhealthy_threshold,
       restart_max_restarts, restart_initial_backoff_ms, restart_max_backoff_ms,
       restart_backoff_factor, restart_reset_after_ms)
     SELECT id, 8080, '{}'::text[], 1, 512, 1000, 1000, 1000, 1, 3, 5, 500, 5000, 2, 60000
     FROM nibrun.apps WHERE slug = $1`,
    [APP_SLUG],
  );
  await sql.unsafe(
    `INSERT INTO nibrun.deployments (app_id, artifact_id, config_id, state)
     SELECT a.id, ar.id, c.id, 'active'
     FROM nibrun.apps a
     JOIN nibrun.artifacts ar ON ar.app_id = a.id
     JOIN nibrun.app_configs c ON c.app_id = a.id
     WHERE a.slug = $1`,
    [APP_SLUG],
  );
}
