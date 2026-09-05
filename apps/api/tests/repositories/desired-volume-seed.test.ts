import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;

const APP_SLUG = 'seeded';
const ARCHIVE_DIGEST = 'sha256:archive';
const ARCHIVE_KEY = 'imports/app/archive';
const ARCHIVE_NAME = 'pb_data.tar.gz';

type DesiredVolumeRow = {
  seed_digest: string | null;
  seed_size_bytes: string | null;
  seed_object_key: string | null;
  seed_original_file_name: string | null;
};

/**
 * `nibrun.desired_volumes` is what a host is told to hold, and what a filesystem should be created
 * holding reaches it by joining two tables the host never sees. Whether it stops being sent at the
 * right moment is a question only the real view can answer.
 */
describe('what a filesystem is created from travels with the volume, once', () => {
  let sql: SQL;

  beforeAll(async () => {
    sql = await startTestDatabase();
    await seedApp(sql);
  }, DATABASE_START_TIMEOUT_MS);

  afterAll(async () => {
    await stopTestDatabase(sql);
  }, DATABASE_START_TIMEOUT_MS);

  async function desired(): Promise<DesiredVolumeRow> {
    const [row] = (await sql.unsafe(
      `SELECT seed_digest, seed_size_bytes, seed_object_key, seed_original_file_name
       FROM nibrun.desired_volumes`,
    )) as DesiredVolumeRow[];
    if (!row) {
      throw new Error('the seeded app has no desired volume');
    }
    return row;
  }

  test('an app whose deployment named no archive is told to create an empty one', async () => {
    expect(await desired()).toEqual({
      seed_digest: null,
      seed_size_bytes: null,
      seed_object_key: null,
      seed_original_file_name: null,
    });
  });

  test('a deployment naming one carries every field a host needs to pull it', async () => {
    await nameArchive(sql);

    expect(await desired()).toEqual({
      seed_digest: ARCHIVE_DIGEST,
      seed_size_bytes: '4096',
      seed_object_key: ARCHIVE_KEY,
      seed_original_file_name: ARCHIVE_NAME,
    });
  });

  // The host would ignore it — a device that already carries a filesystem is left alone — so this
  // is about keeping a gibibyte off the wire on every pass for the rest of the app's life.
  test('a host having said the filesystem exists is what stops it being sent', async () => {
    await sql.unsafe('UPDATE nibrun.apps SET data_initialized_at = now() WHERE slug = $1', [
      APP_SLUG,
    ]);

    expect((await desired()).seed_digest).toBeNull();
  });

  // An upload nobody has completed names bytes that may never arrive, and a host sent after them
  // would find a key naming nothing.
  test('an archive still awaiting its upload is not sent either', async () => {
    await sql.unsafe('UPDATE nibrun.apps SET data_initialized_at = NULL WHERE slug = $1', [
      APP_SLUG,
    ]);
    await sql.unsafe('UPDATE nibrun.imports SET digest = NULL');

    expect((await desired()).seed_digest).toBeNull();
  });

  test('the volume is still desired whatever the archive is doing', async () => {
    const rows = (await sql.unsafe('SELECT app_id FROM nibrun.desired_volumes')) as unknown[];

    expect(rows).toHaveLength(1);
  });
});

/** An app with one deployment, and one uploaded archive nothing has named yet. */
async function seedApp(sql: SQL): Promise<void> {
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
    `INSERT INTO nibrun.imports (app_id, digest, size_bytes, object_key, original_file_name)
     SELECT id, $2, 4096, $3, $4 FROM nibrun.apps WHERE slug = $1`,
    [APP_SLUG, ARCHIVE_DIGEST, ARCHIVE_KEY, ARCHIVE_NAME],
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

async function nameArchive(sql: SQL): Promise<void> {
  await sql.unsafe(
    `UPDATE nibrun.deployments d
     SET reset_data_from_import_id = im.id
     FROM nibrun.imports im
     WHERE im.app_id = d.app_id`,
  );
}
