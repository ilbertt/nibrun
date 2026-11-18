import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';

let sql: SQL;
const CALLBACK_TEST_TIMEOUT_MS = 15_000;

beforeAll(async function startDatabase() {
  sql = await startTestDatabase();
});

afterAll(async function stopDatabase() {
  await stopTestDatabase(sql);
});

test(
  'GitHub signup, returning accounts and anonymous upgrades work against the migrated Postgres schema',
  async function authenticatesThroughGithubCallback() {
    // Controller suites replace the auth factory with a memory adapter in this process.
    const child = Bun.spawn([process.execPath, 'run', 'tests/support/github-signup.ts'], {
      cwd: new URL('../..', import.meta.url).pathname,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
  },
  CALLBACK_TEST_TIMEOUT_MS,
);
