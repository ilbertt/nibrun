import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import { HostnameSchema, Value } from '@repo/protocol';
import type { SQL } from 'bun';
import type { Queries } from '#db/queries.gen.ts';
import { AppHostnamesRepository } from '#repositories/app-hostnames.repository.ts';
import type { EdgeReport } from '#repositories/custom-hostnames.repository.ts';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;

const APP_SLUG = 'brought';
const BROUGHT = Value.Parse(HostnameSchema, 'brought.example.dev');

const NOT_POINTED_AT_US = 'custom hostname does not CNAME to this zone.';

function waiting(errors: string[]): EdgeReport {
  return { state: 'pending', status: 'pending', sslStatus: 'pending_validation', errors };
}

/**
 * Whether the edge said something new is decided by the statement's own WHERE, which no stub
 * reaches. It matters because the pass asking is on every host report: written through, the
 * row's `updated_at` would say when the edge was last asked rather than when it last answered
 * differently, and the log line keyed on the write would fire a thousand times an hour.
 */
describe('the edge report is written only when it changes', () => {
  let sql: SQL;
  let repo: AppHostnamesRepository;

  // Long enough to pull the image, which the first run on a fresh machine does inside this hook.
  beforeAll(async () => {
    sql = await startTestDatabase();
    await seedBroughtDomain(sql);
    repo = new AppHostnamesRepository(withTypes<Queries>(sql));
  }, DATABASE_START_TIMEOUT_MS);

  afterAll(async () => {
    await stopTestDatabase(sql);
  }, DATABASE_START_TIMEOUT_MS);

  async function row(): Promise<{ state: string; edge_errors: string[]; updated_at: Date }> {
    const [found] = (await sql.unsafe(
      'SELECT state, edge_errors, updated_at FROM nibrun.app_hostnames WHERE hostname = $1',
      [BROUGHT],
    )) as Array<{ state: string; edge_errors: string[]; updated_at: Date }>;
    if (!found) {
      throw new Error(`${BROUGHT} is not in the table.`);
    }
    return found;
  }

  test('the first answer is news, and lands on the row', async () => {
    const changed = await repo.recordEdgeReport({
      hostname: BROUGHT,
      report: waiting([NOT_POINTED_AT_US]),
    });

    expect(changed).toBe(true);
    expect((await row()).edge_errors).toEqual([NOT_POINTED_AT_US]);
  });

  test('the same answer again is not, and leaves updated_at where it was', async () => {
    const before = await row();

    const changed = await repo.recordEdgeReport({
      hostname: BROUGHT,
      report: waiting([NOT_POINTED_AT_US]),
    });

    expect(changed).toBe(false);
    expect((await row()).updated_at).toEqual(before.updated_at);
  });

  test('an error that clears is news even though the state has not moved', async () => {
    const changed = await repo.recordEdgeReport({ hostname: BROUGHT, report: waiting([]) });

    expect(changed).toBe(true);
    expect(await row()).toMatchObject({ state: 'pending', edge_errors: [] });
  });

  test('and so is the state moving, which is what settles the row', async () => {
    const changed = await repo.recordEdgeReport({
      hostname: BROUGHT,
      report: { state: 'active', status: 'active', sslStatus: 'active', errors: [] },
    });

    expect(changed).toBe(true);
    expect((await row()).state).toBe('active');
  });
});

async function seedBroughtDomain(sql: SQL): Promise<void> {
  await sql.unsafe(
    `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ('owner', 'owner', 'owner@example.com', true, now(), now())`,
  );
  await sql.unsafe(`INSERT INTO nibrun.apps (owner_id, slug) VALUES ('owner', $1)`, [APP_SLUG]);
  await sql.unsafe(
    `INSERT INTO nibrun.app_hostnames (app_id, hostname, kind)
     SELECT id, $1, 'custom' FROM nibrun.apps WHERE slug = $2`,
    [BROUGHT, APP_SLUG],
  );
}
