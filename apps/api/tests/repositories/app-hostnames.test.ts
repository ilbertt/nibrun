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

// One database for the file, because bringing a container up and migrating it is the expensive
// part and every describe below wants the same app to hang its hostnames off.
let sql: SQL;
let repo: AppHostnamesRepository;

// Long enough to pull the image, which the first run on a fresh machine does inside this hook.
beforeAll(async () => {
  sql = await startTestDatabase();
  await seedApp(sql);
  repo = new AppHostnamesRepository(withTypes<Queries>(sql));
}, DATABASE_START_TIMEOUT_MS);

afterAll(async () => {
  await stopTestDatabase(sql);
}, DATABASE_START_TIMEOUT_MS);

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
  beforeAll(async () => {
    await addCustomHostname({ sql, hostname: BROUGHT });
  });

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

/**
 * The order is the statement's, so no stub reaches it. It matters because the batch is small and
 * the pass is on every host report: read from the top each time, a batch's worth of older rows
 * would be asked about on every report and the ones behind them never, until the older ones
 * settled or lapsed a week later.
 */
describe('the pending batch carries on from where the last one stopped', () => {
  // Inserted in this order, so their uuidv7 ids sort the same way.
  const WAITING = ['first', 'second', 'third'].map((label) =>
    Value.Parse(HostnameSchema, `${label}.example.dev`),
  );
  const BATCH = 2;
  const ids = new Map<string, string>();

  beforeAll(async () => {
    for (const hostname of WAITING) {
      ids.set(hostname, await addCustomHostname({ sql, hostname }));
    }
  });

  async function batchAfter(hostname: string | null): Promise<string[]> {
    const after = hostname === null ? null : (ids.get(hostname) ?? null);
    return (await repo.listPendingCustom({ after, limit: BATCH })).map((row) => row.hostname);
  }

  test('with nowhere to carry on from, it starts at the top', async () => {
    expect(await batchAfter(null)).toEqual(WAITING.slice(0, BATCH));
  });

  test('past the end it comes round to the top, after the rows not yet reached', async () => {
    expect(await batchAfter('second.example.dev')).toEqual([
      'third.example.dev',
      'first.example.dev',
    ]);
  });

  test('so the row a full batch would have hidden is reached on the next pass', async () => {
    const first = await batchAfter(null);
    const second = await batchAfter(first.at(-1) ?? null);

    expect(new Set([...first, ...second])).toEqual(new Set(WAITING));
  });

  // The brought domain from the describe above is `active` by now, and a platform hostname is
  // never anything the edge is asked about.
  test('and only rows still waiting are in it', async () => {
    const all = await repo.listPendingCustom({ after: null, limit: WAITING.length * BATCH });

    expect(all.map((row) => row.hostname).sort()).toEqual([...WAITING].sort());
  });
});

async function seedApp(sql: SQL): Promise<void> {
  await sql.unsafe(
    `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ('owner', 'owner', 'owner@example.com', true, now(), now())`,
  );
  await sql.unsafe(`INSERT INTO nibrun.apps (owner_id, slug) VALUES ('owner', $1)`, [APP_SLUG]);
}

async function addCustomHostname({
  sql,
  hostname,
}: {
  sql: SQL;
  hostname: string;
}): Promise<string> {
  const [row] = (await sql.unsafe(
    `INSERT INTO nibrun.app_hostnames (app_id, hostname, kind)
     SELECT id, $1, 'custom' FROM nibrun.apps WHERE slug = $2
     RETURNING id`,
    [hostname, APP_SLUG],
  )) as Array<{ id: string }>;
  if (!row) {
    throw new Error(`${APP_SLUG} is not in the table.`);
  }
  return row.id;
}
