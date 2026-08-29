import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import {
  type AppId,
  AppIdSchema,
  type ComputeUsage,
  DnsLabelSchema,
  HostnameSchema,
  OWNED_APP_STATES,
  type OwnerId,
  OwnerIdSchema,
  type TenantEnvironment,
  TenantEnvironmentSchema,
  type Timestamp,
  TimestampSchema,
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

/**
 * The one place the upsert and the join are actually run. A reading arrives on a host report, so
 * it is written many times per app and read back on every request an owner makes for that app.
 */
describe('what a host measured of a filesystem is kept against the app that owns it', () => {
  const TOTAL_BYTES = 8_455_712_768;
  const FILLED_BYTES = 1_503_238_553;
  const EMPTIED_BYTES = 4_096;

  const EARLIER = Value.Parse(TimestampSchema, '2026-08-03T10:00:00.000Z');
  const LATER = Value.Parse(TimestampSchema, '2026-08-03T10:01:00.000Z');

  function reading({ usedBytes, measuredAt }: { usedBytes: number; measuredAt: Timestamp }) {
    return { totalBytes: TOTAL_BYTES, usedBytes, measuredAt };
  }

  async function readBack(appId: AppId) {
    return (await repo.findById({ appId, ownerId: OWNER_ID }))!;
  }

  test('an app nothing has measured reads back with no reading rather than a zero', async () => {
    const app = await readBack(await createApp('unmeasured'));

    expect(app.volume_total_bytes).toBeNull();
    expect(app.volume_used_bytes).toBeNull();
    expect(app.volume_measured_at).toBeNull();
    expect(app.memory_used_bytes).toBeNull();
    expect(app.cpu_share).toBeNull();
    expect(app.compute_measured_at).toBeNull();
  });

  test('a reading is written and read back beside the app', async () => {
    const appId = await createApp('measured');

    await repo.recordVolumeUsage({
      readings: new Map([[appId, reading({ usedBytes: FILLED_BYTES, measuredAt: EARLIER })]]),
    });
    const app = await readBack(appId);

    expect(Number(app.volume_used_bytes)).toBe(FILLED_BYTES);
    expect(Number(app.volume_total_bytes)).toBe(TOTAL_BYTES);
    expect(app.volume_measured_at?.toISOString()).toBe(EARLIER);
  });

  // A host reports the same volume every fifteen seconds and measures it every minute, so this
  // is the ordinary case rather than the exception.
  test('a later reading replaces the one before it', async () => {
    const appId = await createApp('refilled');

    await repo.recordVolumeUsage({
      readings: new Map([[appId, reading({ usedBytes: FILLED_BYTES, measuredAt: EARLIER })]]),
    });
    await repo.recordVolumeUsage({
      readings: new Map([[appId, reading({ usedBytes: EMPTIED_BYTES, measuredAt: LATER })]]),
    });

    expect(Number((await readBack(appId)).volume_used_bytes)).toBe(EMPTIED_BYTES);
  });

  // Two reports can arrive out of order; the older one must not put the older number back.
  test('an older reading arriving late leaves the newer one standing', async () => {
    const appId = await createApp('reordered');

    await repo.recordVolumeUsage({
      readings: new Map([[appId, reading({ usedBytes: EMPTIED_BYTES, measuredAt: LATER })]]),
    });
    await repo.recordVolumeUsage({
      readings: new Map([[appId, reading({ usedBytes: FILLED_BYTES, measuredAt: EARLIER })]]),
    });

    expect(Number((await readBack(appId)).volume_used_bytes)).toBe(EMPTIED_BYTES);
  });

  // One statement for the whole report is the point of taking a map: a host holding many apps
  // must not cost the report one round trip each.
  test('every reading in one report is written by one statement', async () => {
    const first = await createApp('batched-one');
    const second = await createApp('batched-two');

    await repo.recordVolumeUsage({
      readings: new Map([
        [first, reading({ usedBytes: FILLED_BYTES, measuredAt: EARLIER })],
        [second, reading({ usedBytes: EMPTIED_BYTES, measuredAt: EARLIER })],
      ]),
    });

    expect(Number((await readBack(first)).volume_used_bytes)).toBe(FILLED_BYTES);
    expect(Number((await readBack(second)).volume_used_bytes)).toBe(EMPTIED_BYTES);
  });

  // The whole statement must not fail because one of the apps it names has gone.
  test('a batch naming a purged app still writes the readings beside it', async () => {
    const surviving = await createApp('survivor');
    const stranger = Value.Parse(AppIdSchema, '01930000-0000-7000-8000-00000000ffff');

    await repo.recordVolumeUsage({
      readings: new Map([
        [stranger, reading({ usedBytes: FILLED_BYTES, measuredAt: EARLIER })],
        [surviving, reading({ usedBytes: EMPTIED_BYTES, measuredAt: EARLIER })],
      ]),
    });

    expect(Number((await readBack(surviving)).volume_used_bytes)).toBe(EMPTIED_BYTES);
  });

  // A report can name an app this end has already purged, and a reading about one is not worth
  // failing the report that carried it.
  test('a reading about an app that is not there writes nothing and raises nothing', async () => {
    const stranger = Value.Parse(AppIdSchema, '01930000-0000-7000-8000-000000000000');

    await repo.recordVolumeUsage({
      readings: new Map([[stranger, reading({ usedBytes: FILLED_BYTES, measuredAt: EARLIER })]]),
    });

    expect(await repo.findById({ appId: stranger, ownerId: OWNER_ID })).toBeNull();
  });
});

/**
 * The compute half, in the same table and written by a statement of its own — so what this has to
 * prove beyond the family above is that the two do not stand on each other: either can make the
 * row, and the one that made it must not stop the other from landing on it.
 */
describe('what a host measured of a guest is kept beside how full its filesystem is', () => {
  const VOLUME_TOTAL_BYTES = 8_455_712_768;
  const VOLUME_USED_BYTES = 1_503_238_553;
  const MEMORY_TOTAL_BYTES = 1_031_012_352;
  const BUSY_BYTES = 412_401_664;
  const IDLE_BYTES = 96_468_992;
  const BUSY_SHARE = 0.42;
  const IDLE_SHARE = 0.01;

  const EARLIER = Value.Parse(TimestampSchema, '2026-08-03T10:00:00.000Z');
  const LATER = Value.Parse(TimestampSchema, '2026-08-03T10:01:00.000Z');

  function spending({
    memoryUsedBytes,
    cpuShare,
    measuredAt,
  }: {
    memoryUsedBytes: number;
    cpuShare?: number;
    measuredAt: Timestamp;
  }): ComputeUsage {
    return {
      memoryTotalBytes: MEMORY_TOTAL_BYTES,
      memoryUsedBytes,
      ...(cpuShare === undefined ? {} : { cpuShare }),
      measuredAt,
    };
  }

  async function readBack(appId: AppId) {
    return (await repo.findById({ appId, ownerId: OWNER_ID }))!;
  }

  test('a reading is written and read back beside the app', async () => {
    const appId = await createApp('spending');

    await repo.recordComputeUsage({
      readings: new Map([
        [
          appId,
          spending({ memoryUsedBytes: BUSY_BYTES, cpuShare: BUSY_SHARE, measuredAt: EARLIER }),
        ],
      ]),
    });
    const app = await readBack(appId);

    expect(Number(app.memory_total_bytes)).toBe(MEMORY_TOTAL_BYTES);
    expect(Number(app.memory_used_bytes)).toBe(BUSY_BYTES);
    expect(app.cpu_share).toBe(BUSY_SHARE);
    expect(app.compute_measured_at?.toISOString()).toBe(EARLIER);
  });

  /**
   * The first reading taken of a guest has no reading behind it to have been a rate since, and a
   * nought written there is a figure an owner would act on. The column is null while the moment
   * beside it is not, which is the one place the two families differ in shape.
   */
  test('a reading with no share yet writes no share rather than none spent', async () => {
    const appId = await createApp('unrated');

    await repo.recordComputeUsage({
      readings: new Map([[appId, spending({ memoryUsedBytes: BUSY_BYTES, measuredAt: EARLIER })]]),
    });
    const app = await readBack(appId);

    expect(app.cpu_share).toBeNull();
    expect(Number(app.memory_used_bytes)).toBe(BUSY_BYTES);
  });

  test('a later reading replaces the one before it', async () => {
    const appId = await createApp('quietened');

    await repo.recordComputeUsage({
      readings: new Map([
        [
          appId,
          spending({ memoryUsedBytes: BUSY_BYTES, cpuShare: BUSY_SHARE, measuredAt: EARLIER }),
        ],
      ]),
    });
    await repo.recordComputeUsage({
      readings: new Map([
        [appId, spending({ memoryUsedBytes: IDLE_BYTES, cpuShare: IDLE_SHARE, measuredAt: LATER })],
      ]),
    });

    expect((await readBack(appId)).cpu_share).toBe(IDLE_SHARE);
  });

  test('an older reading arriving late leaves the newer one standing', async () => {
    const appId = await createApp('reordered-compute');

    await repo.recordComputeUsage({
      readings: new Map([
        [appId, spending({ memoryUsedBytes: IDLE_BYTES, cpuShare: IDLE_SHARE, measuredAt: LATER })],
      ]),
    });
    await repo.recordComputeUsage({
      readings: new Map([
        [
          appId,
          spending({ memoryUsedBytes: BUSY_BYTES, cpuShare: BUSY_SHARE, measuredAt: EARLIER }),
        ],
      ]),
    });

    expect((await readBack(appId)).cpu_share).toBe(IDLE_SHARE);
  });

  /**
   * A guest whose image predates one of the verbs answers the other, so a host can measure one
   * family for as long as it takes an image to roll out. Whichever arrives first makes the row,
   * and the moment guarding the other family is null on it — which must read as nothing to
   * protect rather than as a reading no newer one can beat.
   */
  test('either family alone makes the row, and the other lands on it afterwards', async () => {
    const appId = await createApp('half-measured');

    await repo.recordComputeUsage({
      readings: new Map([
        [
          appId,
          spending({ memoryUsedBytes: BUSY_BYTES, cpuShare: BUSY_SHARE, measuredAt: EARLIER }),
        ],
      ]),
    });
    const compute = await readBack(appId);
    expect(compute.volume_measured_at).toBeNull();

    await repo.recordVolumeUsage({
      readings: new Map([
        [
          appId,
          { totalBytes: VOLUME_TOTAL_BYTES, usedBytes: VOLUME_USED_BYTES, measuredAt: LATER },
        ],
      ]),
    });
    const both = await readBack(appId);

    expect(Number(both.volume_used_bytes)).toBe(VOLUME_USED_BYTES);
    expect(both.cpu_share).toBe(BUSY_SHARE);
  });

  test('every reading in one report is written by one statement', async () => {
    const first = await createApp('batched-compute-one');
    const second = await createApp('batched-compute-two');

    await repo.recordComputeUsage({
      readings: new Map([
        [
          first,
          spending({ memoryUsedBytes: BUSY_BYTES, cpuShare: BUSY_SHARE, measuredAt: EARLIER }),
        ],
        [
          second,
          spending({ memoryUsedBytes: IDLE_BYTES, cpuShare: IDLE_SHARE, measuredAt: EARLIER }),
        ],
      ]),
    });

    expect(Number((await readBack(first)).memory_used_bytes)).toBe(BUSY_BYTES);
    expect(Number((await readBack(second)).memory_used_bytes)).toBe(IDLE_BYTES);
  });
});
