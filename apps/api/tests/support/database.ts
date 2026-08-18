import { resolve } from 'node:path';
import { SQL } from 'bun';
import { getMigrations } from '#lib/assets.ts';

const COMPOSE_FILE = resolve(import.meta.dir, '..', '..', '..', '..', 'docker-compose.test.yml');

// Fixed rather than discovered, because the compose file publishes it: a test that asked Docker
// which port it got would be reading back what it already said.
const DATABASE_URL = 'postgres://nibrun:nibrun@127.0.0.1:55432/nibrun_test';

// The two the migrations own. Dropped before applying so a run finds the same empty database as
// the one before it, including after a run that was killed before it could tear anything down.
const OWNED_SCHEMAS = ['nibrun', 'auth'];

/**
 * The database this suite checks its SQL against, brought up and migrated.
 *
 * Started here rather than by whatever invoked the tests, so `bun test` means the same thing on a
 * developer's machine as it does in CI. Nothing is configured and nothing is skipped: a rule that
 * only holds where somebody remembered to provide a database is a rule that stops being checked.
 */
export async function startTestDatabase(): Promise<SQL> {
  await compose(['up', '-d', '--wait']);

  const sql = new SQL(DATABASE_URL);
  for (const schema of OWNED_SCHEMAS) {
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  // Read through the same accessor the server migrates from, so a test cannot drift onto a copy
  // of the schema: what it queries is what a deploy would have built.
  for (const [, file] of getMigrations()) {
    await sql.unsafe(await file.text());
  }
  return sql;
}

export async function stopTestDatabase(sql: SQL | undefined): Promise<void> {
  await sql?.end();
  await compose(['down']);
}

async function compose(args: string[]): Promise<void> {
  const run = Bun.spawn(['docker', 'compose', '-f', COMPOSE_FILE, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if ((await run.exited) === 0) {
    return;
  }
  throw new Error(
    `\`docker compose ${args.join(' ')}\` failed. This suite runs its own database and Docker ` +
      `has to be running for it.\n${await new Response(run.stderr).text()}`,
  );
}
