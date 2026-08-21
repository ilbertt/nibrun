import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import {
  type AppId,
  DnsLabelSchema,
  HostnameSchema,
  OWNED_APP_STATES,
  type OwnerId,
  OwnerIdSchema,
  type TenantEnvironment,
  TenantEnvironmentSchema,
  Value,
} from '@repo/protocol';
import type { SQL } from 'bun';
import type { Queries } from '#db/queries.gen.ts';
import { configWithDefaults, type SealedEnvironmentPatch } from '#lib/app-config.ts';
import { openSecret, sealEnvironment, sealedFromStore } from '#lib/tenant-secrets.ts';
import { AppsRepository, LIVE_APP_STATES } from '#repositories/apps.repository.ts';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';
import { TEST_SECRETS_KEY } from '#tests/support/secrets.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;

const OWNER_ID = Value.Parse(OwnerIdSchema, 'owner');
const STRANGER_ID = Value.Parse(OwnerIdSchema, 'stranger');
const APP_SLUG = Value.Parse(DnsLabelSchema, 'pocketbase');
const PLATFORM = Value.Parse(HostnameSchema, 'pocketbase.apps.example.com');

const FIRST_TOKEN = 'sk-sealed-once';

// One database for the file, because bringing a container up and migrating it is the expensive
// part and every describe below wants the same empty schema.
let sql: SQL;
let repo: AppsRepository;

// Long enough to pull the image, which the first run on a fresh machine does inside this hook.
beforeAll(async () => {
  sql = await startTestDatabase();
  for (const id of [OWNER_ID, STRANGER_ID]) {
    await sql.unsafe(
      `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $1, $2, true, now(), now())`,
      [id, `${id}@example.com`],
    );
  }
  repo = new AppsRepository(withTypes<Queries>(sql));
}, DATABASE_START_TIMEOUT_MS);

afterAll(async () => {
  await stopTestDatabase(sql);
}, DATABASE_START_TIMEOUT_MS);

function environment(entries: Record<string, string>): TenantEnvironment {
  return Value.Parse(TenantEnvironmentSchema, entries);
}

function sealed(entries: Record<string, string>) {
  return sealEnvironment({ key: TEST_SECRETS_KEY, environment: environment(entries) });
}

/** An app of its own for whoever asks, so no test is holding a row another test is moving. */
async function createApp(slug: string): Promise<AppId> {
  const label = Value.Parse(DnsLabelSchema, slug);
  const created = await repo.create({
    ownerId: OWNER_ID,
    slug: label,
    hostname: Value.Parse(HostnameSchema, `${label}.apps.example.com`),
    config: { ...configWithDefaults(), environment: {} },
  });
  return created.app.id;
}

async function storedState(appId: AppId): Promise<string | undefined> {
  const [row] = (await sql.unsafe('SELECT state FROM nibrun.apps WHERE id = $1', [
    appId,
  ])) as Array<{
    state: string;
  }>;
  return row?.state;
}

/**
 * A config version is what a deployment pins and its variables are part of that version, so a
 * patch writes a new version rather than editing one. Which of the previous version's variables
 * the new one inherits is SQL, and the ciphertext an owner cannot restate is what rides on it —
 * so this is exercised against the database rather than a fake.
 */
describe('a config patch carries forward every variable it says nothing about', () => {
  let appId: AppId;
  let ownerId: OwnerId;

  beforeAll(async () => {
    const created = await repo.create({
      ownerId: OWNER_ID,
      slug: APP_SLUG,
      hostname: PLATFORM,
      config: {
        ...configWithDefaults(),
        environment: sealed({ TOKEN: FIRST_TOKEN, LOG_LEVEL: 'debug' }),
      },
    });
    appId = created.app.id;
    ownerId = created.app.owner_id;
  });

  /** As it is stored: ciphertext, which is the only form any of this ever reaches the column in. */
  async function storedEnvironment(): Promise<Record<string, string>> {
    const rows = (await sql.unsafe(
      `SELECT e.name, e.value
       FROM nibrun.app_config_environment e
       WHERE e.config_id = (
         SELECT c.id FROM nibrun.app_configs c WHERE c.app_id = $1 ORDER BY c.id DESC LIMIT 1
       )`,
      [appId],
    )) as Array<{ name: string; value: string }>;
    return Object.fromEntries(rows.map((row) => [row.name, row.value]));
  }

  function patchEnvironment(environment: SealedEnvironmentPatch) {
    return repo.updateConfig({ appId, ownerId, patch: { environment } });
  }

  function opened(value: string | undefined): string {
    return openSecret({ key: TEST_SECRETS_KEY, sealed: sealedFromStore(value ?? '') });
  }

  test('a patch that says nothing about the environment keeps all of it', async () => {
    const before = await storedEnvironment();

    await repo.updateConfig({ appId, ownerId, patch: { args: ['serve'] } });

    expect(await storedEnvironment()).toEqual(before);
  });

  // The same ciphertext rather than the same value: a variable nobody edited is never opened, so
  // a new envelope for it would mean the api had read a secret it had no reason to.
  test('a name not in the patch arrives at the new version as the bytes the old one held', async () => {
    const before = await storedEnvironment();

    await patchEnvironment({ set: sealed({ LOG_LEVEL: 'info' }), removed: [] });
    const after = await storedEnvironment();

    expect(after.TOKEN).toBe(before.TOKEN);
    expect(opened(after.TOKEN)).toBe(FIRST_TOKEN);
    expect(opened(after.LOG_LEVEL)).toBe('info');
  });

  test('a name the patch removes is a variable the app stops running with', async () => {
    await patchEnvironment({ set: {}, removed: ['LOG_LEVEL'] });

    expect(Object.keys(await storedEnvironment())).toEqual(['TOKEN']);
  });

  // Every patch above appended a version. What the first deployment was launched with is the
  // first of them, and none of this may have reached back and edited it.
  test('the version this app was created with still holds what it was created with', async () => {
    const rows = (await sql.unsafe(
      `SELECT e.name, e.value
       FROM nibrun.app_config_environment e
       WHERE e.config_id = (
         SELECT c.id FROM nibrun.app_configs c WHERE c.app_id = $1 ORDER BY c.id ASC LIMIT 1
       )
       ORDER BY e.name`,
      [appId],
    )) as Array<{ name: string; value: string }>;

    expect(rows.map((row) => row.name)).toEqual(['LOG_LEVEL', 'TOKEN']);
    expect(opened(rows[1]?.value)).toBe(FIRST_TOKEN);
  });

  test('a deleted app with only its hostname left is still purgeable', async () => {
    await repo.updateState({ appId, ownerId, state: 'deleting', from: LIVE_APP_STATES });
    await repo.finishDeleting({ appId });

    expect(await repo.listPurgeable({ limit: 8 })).toEqual([appId]);
  });
});

/**
 * Which states an app may be moved out of is the `WHERE` clause and nothing else, so no test over
 * a fake repository can reach it — this is the one place it is exercised.
 */
describe('an owner moves their app between the two states they own', () => {
  test('suspending it is the row moving, and the row that comes back is the one that moved', async () => {
    const appId = await createApp('suspends');

    const app = await repo.updateState({
      appId,
      ownerId: OWNER_ID,
      state: 'suspended',
      from: OWNED_APP_STATES,
    });

    expect(app?.state).toBe('suspended');
    expect(await storedState(appId)).toBe('suspended');
  });

  test('and resuming it puts it back where it was', async () => {
    const appId = await createApp('resumes');
    await repo.updateState({
      appId,
      ownerId: OWNER_ID,
      state: 'suspended',
      from: OWNED_APP_STATES,
    });

    const app = await repo.updateState({
      appId,
      ownerId: OWNER_ID,
      state: 'active',
      from: OWNED_APP_STATES,
    });

    expect(app?.state).toBe('active');
    expect(await storedState(appId)).toBe('active');
  });

  // The host has already been told to remove the filesystem. Resuming onto one that is going is
  // an app brought back to nothing, so the statement declines rather than writes.
  test('an app being deleted is left exactly where it is', async () => {
    const appId = await createApp('doomed');
    await repo.updateState({ appId, ownerId: OWNER_ID, state: 'deleting', from: LIVE_APP_STATES });

    expect(
      await repo.updateState({
        appId,
        ownerId: OWNER_ID,
        state: 'active',
        from: OWNED_APP_STATES,
      }),
    ).toBeNull();
    expect(await storedState(appId)).toBe('deleting');
  });

  test('and an app belonging to somebody else is not one to suspend', async () => {
    const appId = await createApp('theirs');

    expect(
      await repo.updateState({
        appId,
        ownerId: STRANGER_ID,
        state: 'suspended',
        from: OWNED_APP_STATES,
      }),
    ).toBeNull();
    expect(await storedState(appId)).toBe('active');
  });
});
