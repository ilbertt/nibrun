import { afterAll, beforeAll, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import { AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { SQL } from 'bun';
import type { Queries } from '#db/queries.gen.ts';
import { AppsRepository } from '#repositories/apps.repository.ts';
import { OWNER_ID } from '#tests/services/support/fixtures.ts';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';
import { DEPLOY_PUBLIC_KEY } from '#tests/support/deploy-key.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;
let sql: SQL;

beforeAll(async () => {
  sql = await startTestDatabase();
  await sql.unsafe(
    `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, $1, $2, true, now(), now())`,
    [OWNER_ID, `${OWNER_ID}@example.com`],
  );
}, DATABASE_START_TIMEOUT_MS);

afterAll(async () => {
  await stopTestDatabase(sql);
}, DATABASE_START_TIMEOUT_MS);

test('a deleted app with only deploy keys is found and fully purged', async () => {
  const [app] = await sql.unsafe(
    'INSERT INTO nibrun.apps (owner_id, name, slug) VALUES ($1, $2, $2) RETURNING id',
    [OWNER_ID, 'key-purge'],
  );
  const appId = Value.Parse(AppIdSchema, app.id);
  await sql.unsafe(
    'INSERT INTO nibrun.deploy_keys (app_id, name, public_key) VALUES ($1, $2, $3)',
    [appId, 'CI', DEPLOY_PUBLIC_KEY],
  );
  await sql.unsafe("UPDATE nibrun.apps SET state = 'deleted' WHERE id = $1", [appId]);

  const appsRepo = new AppsRepository(withTypes<Queries>(sql));
  expect(await appsRepo.listPurgeable({ limit: 1 })).toContain(appId);
  await appsRepo.purge({ appId });
  expect(await appsRepo.listPurgeable({ limit: 1 })).not.toContain(appId);
  expect(
    await sql.unsafe('SELECT id FROM nibrun.deploy_keys WHERE app_id = $1', [appId]),
  ).toHaveLength(0);
});
