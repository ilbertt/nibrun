import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;

const APP_SLUG = 'lazy';
const SHORT_IDLE_MS = 60_000;

type DesiredRow = { state: string; activation: string; idle_timeout_ms: number };

/**
 * `nibrun.desired_deployments` is what a host is told to run, and how an app comes up now reaches
 * it from a column on the app rather than from the config a deployment pinned. That is the whole
 * point of it living there — an owner changes how their app runs without deploying — and nothing
 * short of the real view and the real constraint can say whether it does.
 */
describe('how an app comes up travels with what it should be doing', () => {
  let sql: SQL;

  beforeAll(async () => {
    sql = await startTestDatabase();
    await seedDeployedApp(sql);
  }, DATABASE_START_TIMEOUT_MS);

  afterAll(async () => {
    await stopTestDatabase(sql);
  }, DATABASE_START_TIMEOUT_MS);

  async function desired(): Promise<DesiredRow> {
    const [row] = (await sql.unsafe(
      'SELECT state, activation, idle_timeout_ms FROM nibrun.desired_deployments',
    )) as DesiredRow[];
    if (!row) {
      throw new Error('the seeded app is not in desired state');
    }
    return row;
  }

  test('an app nobody has said anything about waits to be asked for', async () => {
    expect(await desired()).toMatchObject({ state: 'active', activation: 'on-request' });
  });

  // The direction that is now the edit: waiting to be asked is what an app gets, and being kept
  // up is what its owner goes and says.
  test('one column is the whole of turning it off', async () => {
    await sql.unsafe('UPDATE nibrun.apps SET activation = $1 WHERE slug = $2', [
      'always',
      APP_SLUG,
    ]);

    expect(await desired()).toMatchObject({ state: 'active', activation: 'always' });
  });

  test('and how long it may go unasked-for rides beside it', async () => {
    await sql.unsafe('UPDATE nibrun.apps SET idle_timeout_ms = $1 WHERE slug = $2', [
      SHORT_IDLE_MS,
      APP_SLUG,
    ]);

    expect((await desired()).idle_timeout_ms).toBe(SHORT_IDLE_MS);
  });

  // Both columns repeat something @repo/protocol states and nothing compares the two, so the
  // check is the only thing standing between a typo and a host being told a policy it cannot act
  // on — which it would read as `always`, quietly keeping every such app up.
  test('an activation nothing implements is refused rather than stored', async () => {
    expect(
      await refused(() =>
        sql.unsafe('UPDATE nibrun.apps SET activation = $1 WHERE slug = $2', [
          'sometimes',
          APP_SLUG,
        ]),
      ),
    ).toBe(true);
  });

  test('and so is a timeout too short to be anything but a mistake', async () => {
    expect(
      await refused(() =>
        sql.unsafe('UPDATE nibrun.apps SET idle_timeout_ms = 1000 WHERE slug = $1', [APP_SLUG]),
      ),
    ).toBe(true);
  });

  // Suspending is the stricter answer and has to win: the host reads one field, and an app told
  // it runs on request would be started again by whoever found its hostname next.
  test('a suspended app keeps its policy and is stopped anyway', async () => {
    // Both columns rather than the state alone: the policy this has to win over is the one a
    // visitor could act on, so the app is put back on request here instead of inheriting whatever
    // the test above left.
    await sql.unsafe('UPDATE nibrun.apps SET state = $1, activation = $2 WHERE slug = $3', [
      'suspended',
      'on-request',
      APP_SLUG,
    ]);

    expect(await desired()).toMatchObject({ state: 'suspended', activation: 'on-request' });
  });
});

/** Whether the database turned the statement down, without the failure ending the test. */
async function refused(statement: () => Promise<unknown>): Promise<boolean> {
  try {
    await statement();
    return false;
  } catch {
    return true;
  }
}

/** An app a host would be told to run: one live deployment, one config version. */
async function seedDeployedApp(sql: SQL): Promise<void> {
  await sql.unsafe(
    `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ('owner', 'owner', 'owner@example.com', true, now(), now())`,
  );
  await sql.unsafe(`INSERT INTO nibrun.apps (owner_id, slug) VALUES ('owner', $1)`, [APP_SLUG]);
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
  await sql.unsafe(
    `INSERT INTO nibrun.deployments (app_id, artifact_id, config_id, state)
     SELECT a.id, ar.id, c.id, 'running'
     FROM nibrun.apps a
     JOIN nibrun.artifacts ar ON ar.app_id = a.id
     JOIN nibrun.app_configs c ON c.app_id = a.id
     WHERE a.slug = $1`,
    [APP_SLUG],
  );
}
