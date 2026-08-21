import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import {
  type AppId,
  DnsLabelSchema,
  HostnameSchema,
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
import { AppsRepository } from '#repositories/apps.repository.ts';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';
import { TEST_SECRETS_KEY } from '#tests/support/secrets.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;

const OWNER_ID = Value.Parse(OwnerIdSchema, 'owner');
const APP_SLUG = Value.Parse(DnsLabelSchema, 'pocketbase');
const PLATFORM = Value.Parse(HostnameSchema, 'pocketbase.apps.example.com');

const FIRST_TOKEN = 'sk-sealed-once';

function environment(entries: Record<string, string>): TenantEnvironment {
  return Value.Parse(TenantEnvironmentSchema, entries);
}

function sealed(entries: Record<string, string>) {
  return sealEnvironment({ key: TEST_SECRETS_KEY, environment: environment(entries) });
}

/**
 * A config version is what a deployment pins and its variables are part of that version, so a
 * patch writes a new version rather than editing one. Which of the previous version's variables
 * the new one inherits is SQL, and the ciphertext an owner cannot restate is what rides on it —
 * so this is exercised against the database rather than a fake.
 */
describe('a config patch carries forward every variable it says nothing about', () => {
  let sql: SQL;
  let repo: AppsRepository;
  let appId: AppId;
  let ownerId: OwnerId;

  // Long enough to pull the image, which the first run on a fresh machine does inside this hook.
  beforeAll(async () => {
    sql = await startTestDatabase();
    await sql.unsafe(
      `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, 'owner', 'owner@example.com', true, now(), now())`,
      [OWNER_ID],
    );

    repo = new AppsRepository(withTypes<Queries>(sql));
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
  }, DATABASE_START_TIMEOUT_MS);

  afterAll(async () => {
    await stopTestDatabase(sql);
  }, DATABASE_START_TIMEOUT_MS);

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
    await repo.updateState({ appId, ownerId, state: 'deleting' });
    await repo.finishDeleting({ appId });

    expect(await repo.listPurgeable({ limit: 8 })).toEqual([appId]);
  });
});
