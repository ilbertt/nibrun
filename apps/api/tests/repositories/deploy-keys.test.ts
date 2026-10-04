import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import { type AppId, AppIdSchema, Value } from '@repo/protocol';
import type { SQL } from 'bun';
import { type Queries, schema } from '#db/queries.gen.ts';
import { AppsRepository } from '#repositories/apps.repository.ts';
import { DeployKeysRepository } from '#repositories/deploy-keys.repository.ts';
import { OTHER_OWNER_ID, OWNER_ID } from '#tests/services/support/fixtures.ts';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';
import { DEPLOY_PUBLIC_KEY } from '#tests/support/deploy-key.ts';
import { refusedBy } from '#tests/support/postgres.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;
let sql: SQL;
let repo: DeployKeysRepository;

beforeAll(async () => {
  sql = await startTestDatabase();
  for (const ownerId of [OWNER_ID, OTHER_OWNER_ID]) {
    await sql.unsafe(
      `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $1, $2, true, now(), now())`,
      [ownerId, `${ownerId}@example.com`],
    );
  }
  repo = new DeployKeysRepository(withTypes<Queries>(sql));
}, DATABASE_START_TIMEOUT_MS);

afterAll(async () => {
  await stopTestDatabase(sql);
}, DATABASE_START_TIMEOUT_MS);

async function createApp(slug: string): Promise<AppId> {
  const [app] = await sql.unsafe(
    'INSERT INTO nibrun.apps (owner_id, name, slug) VALUES ($1, $2, $2) RETURNING id',
    [OWNER_ID, slug],
  );
  return Value.Parse(AppIdSchema, app.id);
}

describe('deploy keys remain inside their app and owner scope', () => {
  test('another owner cannot add, list, or revoke a key', async () => {
    const appId = await createApp('key-owner');
    const owned = { appId, ownerId: OWNER_ID };
    const stranger = { appId, ownerId: OTHER_OWNER_ID };
    const added = await repo.insert({ ...owned, name: 'CI', publicKey: DEPLOY_PUBLIC_KEY });
    expect(added).not.toBeNull();

    expect(await repo.insert({ ...stranger, name: 'CI', publicKey: DEPLOY_PUBLIC_KEY })).toBeNull();
    expect(await repo.listByApp(stranger)).toEqual([]);
    expect(await repo.remove({ ...stranger, deployKeyId: added!.id })).toBe(false);
    expect(await repo.listByApp(owned)).toHaveLength(1);
    expect(await repo.remove({ ...owned, deployKeyId: added!.id })).toBe(true);
    expect(await repo.listByApp(owned)).toEqual([]);
  });

  test('duplicate keys are refused per app, while the same key can serve another app', async () => {
    const appId = await createApp('key-duplicate');
    const input = { appId, ownerId: OWNER_ID, name: 'CI', publicKey: DEPLOY_PUBLIC_KEY };
    await repo.insert(input);

    expect(await refusedBy(() => repo.insert(input))).toBe(
      schema.deploy_keys._constraints.deploy_keys_app_public_key_key._constraintName,
    );
    expect(await repo.insert({ ...input, appId: await createApp('key-other-app') })).not.toBeNull();
  });

  test('a key cannot be revoked through a different app belonging to the same owner', async () => {
    const appId = await createApp('key-scope');
    const added = await repo.insert({
      appId,
      ownerId: OWNER_ID,
      name: 'CI',
      publicKey: DEPLOY_PUBLIC_KEY,
    });

    expect(
      await repo.remove({
        appId: await createApp('key-scope-other'),
        ownerId: OWNER_ID,
        deployKeyId: added!.id,
      }),
    ).toBe(false);
    expect(await repo.listByApp({ appId, ownerId: OWNER_ID })).toHaveLength(1);
  });

  test('deleting apps refuse new keys, and deleted apps have their keys purged', async () => {
    const appId = await createApp('key-purge');
    const input = { appId, ownerId: OWNER_ID, name: 'CI', publicKey: DEPLOY_PUBLIC_KEY };
    await repo.insert(input);
    await sql.unsafe("UPDATE nibrun.apps SET state = 'deleting' WHERE id = $1", [appId]);
    expect(await repo.insert(input)).toBeNull();

    await sql.unsafe("UPDATE nibrun.apps SET state = 'deleted' WHERE id = $1", [appId]);
    const appsRepo = new AppsRepository(withTypes<Queries>(sql));
    expect(await appsRepo.listPurgeable({ limit: 1 })).toContain(appId);
    expect(await repo.listByApp({ appId, ownerId: OWNER_ID })).toEqual([]);
    await appsRepo.purge({ appId });
    expect(await appsRepo.listPurgeable({ limit: 1 })).not.toContain(appId);
  });
});
