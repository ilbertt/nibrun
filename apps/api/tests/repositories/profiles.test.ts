import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;

const SIGNED_UP = 'arrived';
const LEAVING = 'departing';

type ProfileRow = { owner_id: string };

/**
 * The row is written by a trigger and by nothing in this codebase, so the only thing that can say
 * whether signing somebody up gives them one is the real schema.
 */
describe('a person nibrun has signed up has a profile from the moment they exist', () => {
  let sql: SQL;

  async function profileFor(ownerId: string): Promise<ProfileRow | undefined> {
    const [row] = (await sql.unsafe('SELECT owner_id FROM nibrun.profiles WHERE owner_id = $1', [
      ownerId,
    ])) as ProfileRow[];
    return row;
  }

  async function signUp(id: string): Promise<void> {
    await sql.unsafe(
      `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $1, $2, true, now(), now())`,
      [id, `${id}@example.com`],
    );
  }

  beforeAll(async () => {
    sql = await startTestDatabase();
    await signUp(SIGNED_UP);
  }, DATABASE_START_TIMEOUT_MS);

  afterAll(async () => {
    await stopTestDatabase(sql);
  }, DATABASE_START_TIMEOUT_MS);

  test('the profile is there without anything having asked for one', async () => {
    expect(await profileFor(SIGNED_UP)).toBeDefined();
  });

  /** The user is going, and what nibrun held about them is not a reason to keep them. */
  test('deleting the person takes their profile with them', async () => {
    await signUp(LEAVING);
    expect(await profileFor(LEAVING)).toBeDefined();

    await sql.unsafe('DELETE FROM auth."user" WHERE id = $1', [LEAVING]);

    expect(await profileFor(LEAVING)).toBeUndefined();
  });
});
