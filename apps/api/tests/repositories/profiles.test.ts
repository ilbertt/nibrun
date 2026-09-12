import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;

const SIGNED_UP = 'arrived';
const LEAVING = 'departing';
const STRANGER = 'unnamed';
const CLAIMANT = 'claimant';

// What the migrations give a stranger: the two numbers 0048 writes, restated so a change to
// either is a change here too.
const ONE_APP = 1;
const ONE_HOUR_SECONDS = 3600;
const MS_PER_SECOND = 1000;

// The defaults a person with an identity gets — the column default, and no lifetime at all.
const DEFAULT_APPS = 3;

type ProfileRow = {
  owner_id: string;
  quota_apps_max_count: number;
  app_lifetime_seconds: number | null;
};

type DeadlineRow = { expires_at: Date };

type ExpirableRow = { app_id: string; owner_id: string };

/**
 * The row is written by a trigger and by nothing in this codebase, so the only thing that can say
 * whether signing somebody up gives them one is the real schema.
 */
describe('a person nibrun has signed up has a profile from the moment they exist', () => {
  let sql: SQL;

  async function profileFor(ownerId: string): Promise<ProfileRow | undefined> {
    const [row] = (await sql.unsafe(
      'SELECT owner_id, quota_apps_max_count, app_lifetime_seconds FROM nibrun.profiles WHERE owner_id = $1',
      [ownerId],
    )) as ProfileRow[];
    return row;
  }

  async function signUp(id: string): Promise<void> {
    await sql.unsafe(
      `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $1, $2, true, now(), now())`,
      [id, `${id}@example.com`],
    );
  }

  /** Signed in by better-auth's anonymous plugin, which is the one writer of this column. */
  async function arriveWithoutAnIdentity(id: string): Promise<void> {
    await sql.unsafe(
      `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt", "isAnonymous")
       VALUES ($1, $1, $2, false, now(), now(), true)`,
      [id, `${id}@example.com`],
    );
  }

  /**
   * An app whose creation is some way in the past. `created_at` is derived from the id, so the
   * past is written by minting the id there.
   */
  async function createAppAgo({
    ownerId,
    slug,
    ago,
  }: {
    ownerId: string;
    slug: string;
    ago: string;
  }): Promise<string> {
    const [row] = (await sql.unsafe(
      `INSERT INTO nibrun.apps (id, owner_id, slug)
       VALUES (uuidv7($3::interval), $1, $2)
       RETURNING id`,
      [ownerId, slug, ago],
    )) as Array<{ id: string }>;
    if (!row) {
      throw new Error('Inserting into nibrun.apps returned no row.');
    }
    return row.id;
  }

  async function deadlineFor(appId: string): Promise<DeadlineRow | undefined> {
    const [row] = (await sql.unsafe(
      'SELECT expires_at FROM nibrun.app_deadlines WHERE app_id = $1',
      [appId],
    )) as DeadlineRow[];
    return row;
  }

  async function createdAt(appId: string): Promise<Date> {
    const [row] = (await sql.unsafe('SELECT created_at FROM nibrun.apps WHERE id = $1', [
      appId,
    ])) as Array<{ created_at: Date }>;
    if (!row) {
      throw new Error('The app is not there.');
    }
    return row.created_at;
  }

  async function expirable(): Promise<ExpirableRow[]> {
    return (await sql.unsafe(
      'SELECT app_id, owner_id FROM nibrun.expirable_apps',
    )) as ExpirableRow[];
  }

  beforeAll(async () => {
    sql = await startTestDatabase();
    await signUp(SIGNED_UP);
  }, DATABASE_START_TIMEOUT_MS);

  afterAll(async () => {
    await stopTestDatabase(sql);
  }, DATABASE_START_TIMEOUT_MS);

  test('the profile is there without anything having asked for one', async () => {
    expect(await profileFor(SIGNED_UP)).toMatchObject({
      quota_apps_max_count: DEFAULT_APPS,
      app_lifetime_seconds: null,
    });
  });

  /** The user is going, and what nibrun held about them is not a reason to keep them. */
  test('deleting the person takes their profile with them', async () => {
    await signUp(LEAVING);
    expect(await profileFor(LEAVING)).toBeDefined();

    await sql.unsafe('DELETE FROM auth."user" WHERE id = $1', [LEAVING]);

    expect(await profileFor(LEAVING)).toBeUndefined();
  });

  describe('a person who arrived without an identity is given one app for an hour', () => {
    beforeAll(async () => {
      await arriveWithoutAnIdentity(STRANGER);
      await signUp(CLAIMANT);
    });

    test('their profile says so in the two numbers', async () => {
      expect(await profileFor(STRANGER)).toMatchObject({
        quota_apps_max_count: ONE_APP,
        app_lifetime_seconds: ONE_HOUR_SECONDS,
      });
    });

    test('their app is due an hour after it was made', async () => {
      const appId = await createAppAgo({ ownerId: STRANGER, slug: 'just-now', ago: '0' });

      const deadline = await deadlineFor(appId);
      const made = await createdAt(appId);

      expect(deadline?.expires_at.getTime()).toBe(
        made.getTime() + ONE_HOUR_SECONDS * MS_PER_SECOND,
      );
      expect(await expirable()).not.toContainEqual({ app_id: appId, owner_id: STRANGER });
    });

    test('once the hour has passed the app is listed to be deleted, as its owner', async () => {
      const appId = await createAppAgo({ ownerId: STRANGER, slug: 'two-hours', ago: '-2 hours' });

      expect(await expirable()).toContainEqual({ app_id: appId, owner_id: STRANGER });
    });

    test('an app already being deleted is not listed again', async () => {
      const appId = await createAppAgo({ ownerId: STRANGER, slug: 'going', ago: '-2 hours' });
      await sql.unsafe(`UPDATE nibrun.apps SET state = 'deleting' WHERE id = $1`, [appId]);

      expect(await expirable()).not.toContainEqual({ app_id: appId, owner_id: STRANGER });
    });

    /** Signing in with an identity moves the app, and the profile it lands in has no lifetime. */
    test('an app that changes hands to a person with an identity is kept', async () => {
      const appId = await createAppAgo({ ownerId: STRANGER, slug: 'claimed', ago: '-2 hours' });
      await sql.unsafe('UPDATE nibrun.apps SET owner_id = $2 WHERE id = $1', [appId, CLAIMANT]);

      expect(await deadlineFor(appId)).toBeUndefined();
      expect(await expirable()).not.toContainEqual({ app_id: appId, owner_id: CLAIMANT });
    });
  });
});
