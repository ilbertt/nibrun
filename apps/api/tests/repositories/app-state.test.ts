import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import {
  type AppId,
  type DnsLabel,
  DnsLabelSchema,
  HostnameSchema,
  OwnerIdSchema,
  Value,
} from '@repo/protocol';
import type { SQL } from 'bun';
import type { Queries } from '#db/queries.gen.ts';
import { configWithDefaults } from '#lib/app-config.ts';
import { AppsRepository } from '#repositories/apps.repository.ts';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;

const OWNER_ID = Value.Parse(OwnerIdSchema, 'owner');
const STRANGER_ID = Value.Parse(OwnerIdSchema, 'stranger');

const RUNNING_SLUG = Value.Parse(DnsLabelSchema, 'pocketbase');
const DOOMED_SLUG = Value.Parse(DnsLabelSchema, 'gitea');

/**
 * Which states an app may be moved out of is the `WHERE` clause and nothing else, so no test over
 * a fake repository can reach it — this is the one place it is exercised.
 */
describe('an owner moves their app between the two states they own', () => {
  let sql: SQL;
  let repo: AppsRepository;
  let appId: AppId;
  let doomedId: AppId;

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
    appId = await create(RUNNING_SLUG);
    doomedId = await create(DOOMED_SLUG);
  }, DATABASE_START_TIMEOUT_MS);

  afterAll(async () => {
    await stopTestDatabase(sql);
  }, DATABASE_START_TIMEOUT_MS);

  async function create(slug: DnsLabel): Promise<AppId> {
    const created = await repo.create({
      ownerId: OWNER_ID,
      slug,
      hostname: Value.Parse(HostnameSchema, `${slug}.apps.example.com`),
      config: { ...configWithDefaults(), environment: {} },
    });
    return created.app.id;
  }

  async function storedState(id: AppId): Promise<string | undefined> {
    const [row] = (await sql.unsafe('SELECT state FROM nibrun.apps WHERE id = $1', [id])) as Array<{
      state: string;
    }>;
    return row?.state;
  }

  test('suspending it is the row moving, and the row that comes back is the one that moved', async () => {
    const app = await repo.updateOwnedState({ appId, ownerId: OWNER_ID, state: 'suspended' });

    expect(app?.state).toBe('suspended');
    expect(await storedState(appId)).toBe('suspended');
  });

  test('and resuming it puts it back where it was', async () => {
    const app = await repo.updateOwnedState({ appId, ownerId: OWNER_ID, state: 'active' });

    expect(app?.state).toBe('active');
    expect(await storedState(appId)).toBe('active');
  });

  // The host has already been told to remove the filesystem. Resuming onto one that is going is
  // an app brought back to nothing, so the statement declines rather than writes.
  test('an app being deleted is left exactly where it is', async () => {
    await repo.updateState({ appId: doomedId, ownerId: OWNER_ID, state: 'deleting' });

    expect(
      await repo.updateOwnedState({ appId: doomedId, ownerId: OWNER_ID, state: 'active' }),
    ).toBeNull();
    expect(await storedState(doomedId)).toBe('deleting');
  });

  test('and an app belonging to somebody else is not one to suspend', async () => {
    expect(
      await repo.updateOwnedState({ appId, ownerId: STRANGER_ID, state: 'suspended' }),
    ).toBeNull();
    expect(await storedState(appId)).toBe('active');
  });
});
