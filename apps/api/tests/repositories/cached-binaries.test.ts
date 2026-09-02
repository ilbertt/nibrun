import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;

const PROVEN = 'proven';
const UNPROVEN = 'unproven';
const UPLOADED = 'uploaded';

const SHA256_LENGTH = 64;
const PROVEN_DIGEST = 'a'.repeat(SHA256_LENGTH);
const UNPROVEN_DIGEST = 'b'.repeat(SHA256_LENGTH);

type SeededApp = {
  sql: SQL;
  slug: string;
  sourceDigest: string | null;
  activated: boolean;
};

/**
 * `nibrun.cached_binaries` is the whole of what makes a second deploy of the same release skip
 * the download, and every one of its clauses is load-bearing in a way only the real view can
 * settle: what it leaves out is a binary handed to somebody on the strength of a fetch that was
 * never shown to run, or bytes an app took with it when it was deleted.
 */
describe('a binary is remembered by the deployment that answered for it', () => {
  let sql: SQL;

  beforeAll(async () => {
    sql = await startTestDatabase();
    await seedOwner({ sql });
    await seedApp({ sql, slug: PROVEN, sourceDigest: PROVEN_DIGEST, activated: true });
    await seedApp({ sql, slug: UNPROVEN, sourceDigest: UNPROVEN_DIGEST, activated: false });
    await seedApp({ sql, slug: UPLOADED, sourceDigest: null, activated: true });
  }, DATABASE_START_TIMEOUT_MS);

  afterAll(async () => {
    await stopTestDatabase(sql);
  }, DATABASE_START_TIMEOUT_MS);

  async function cached(): Promise<{ source_digest: string; object_key: string }[]> {
    return (await sql.unsafe(
      'SELECT source_digest, object_key FROM nibrun.cached_binaries ORDER BY source_digest',
    )) as { source_digest: string; object_key: string }[];
  }

  test('a url whose binary went on to serve is one the next fetch can skip', async () => {
    expect(await cached()).toEqual([
      { source_digest: PROVEN_DIGEST, object_key: `artifacts/${PROVEN}` },
    ]);
  });

  // The distinction the whole view exists to draw. Fetching, storing and hashing a binary says
  // the bytes arrived; only a microVM answering a health check says they were worth arriving.
  test('a fetch no deployment ever answered for is not handed to the next person', async () => {
    expect(await cached()).not.toContainEqual(
      expect.objectContaining({ source_digest: UNPROVEN_DIGEST }),
    );
  });

  test('and one deployed since is', async () => {
    await activate({ sql, slug: UNPROVEN });

    expect(await cached()).toContainEqual(
      expect.objectContaining({ source_digest: UNPROVEN_DIGEST }),
    );
  });

  /**
   * The bytes outlive the row that names them only until the last app naming them is purged, so
   * an app on its way out has to stop vouching for its binary first. A row left here would send
   * the next fetch to an object key nothing is going to answer.
   */
  test('an app being deleted takes its binary out of everyone else’s reach', async () => {
    await sql.unsafe(`UPDATE nibrun.apps SET state = 'deleted' WHERE slug = $1`, [PROVEN]);

    expect(await cached()).not.toContainEqual(
      expect.objectContaining({ source_digest: PROVEN_DIGEST }),
    );
  });
});

async function seedOwner({ sql }: { sql: SQL }): Promise<void> {
  await sql.unsafe(
    `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ('owner', 'owner', 'owner@example.com', true, now(), now())`,
  );
}

async function activate({ sql, slug }: { sql: SQL; slug: string }): Promise<void> {
  await sql.unsafe(
    `UPDATE nibrun.deployments d SET activated_at = now()
     FROM nibrun.apps a WHERE a.id = d.app_id AND a.slug = $1`,
    [slug],
  );
}

/**
 * An app deployed once. The artifact's object key is the slug's, so a row reaching the view is
 * traceable to the app that put it there rather than to whichever seed happened to run first.
 *
 * An upload is seeded as the same shape with no `source_digest`, because that is exactly what
 * distinguishes one: nothing was fetched, so there is no url anybody could ask for again.
 */
async function seedApp({ sql, slug, sourceDigest, activated }: SeededApp): Promise<void> {
  await sql.unsafe(`INSERT INTO nibrun.apps (owner_id, slug) VALUES ('owner', $1)`, [slug]);
  await sql.unsafe(
    `INSERT INTO nibrun.artifacts
       (app_id, digest, size_bytes, object_key, original_file_name, original_file_url, source_digest)
     SELECT id, $2, 1, $3, 'app', $4, $5 FROM nibrun.apps WHERE slug = $1`,
    [
      slug,
      `digest-${slug}`,
      `artifacts/${slug}`,
      sourceDigest === null ? null : `https://example.com/${slug}`,
      sourceDigest,
    ],
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
    [slug],
  );
  await sql.unsafe(
    `INSERT INTO nibrun.deployments (app_id, artifact_id, config_id, state, activated_at)
     SELECT a.id, ar.id, c.id, 'running', $2
     FROM nibrun.apps a
     JOIN nibrun.artifacts ar ON ar.app_id = a.id
     JOIN nibrun.app_configs c ON c.app_id = a.id
     WHERE a.slug = $1`,
    [slug, activated ? new Date() : null],
  );
}
