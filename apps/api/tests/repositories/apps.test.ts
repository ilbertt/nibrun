import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import {
  type AppId,
  AppIdSchema,
  AppNameSchema,
  type ArtifactId,
  type ComputeUsage,
  DnsLabelSchema,
  FilenameSchema,
  HostnameSchema,
  ObjectKeySchema,
  OWNED_APP_STATES,
  type OwnerId,
  OwnerIdSchema,
  Sha256DigestSchema,
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
import {
  type AppCreation,
  AppsRepository,
  type CreatedApp,
  LIVE_APP_STATES,
} from '#repositories/apps.repository.ts';
import { ArtifactsRepository } from '#repositories/artifacts.repository.ts';
import { DeploymentsRepository } from '#repositories/deployments.repository.ts';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';
import { refusedBy } from '#tests/support/postgres.ts';
import { TEST_SECRETS_KEY } from '#tests/support/secrets.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;

const OWNER_ID = Value.Parse(OwnerIdSchema, 'owner');
const STRANGER_ID = Value.Parse(OwnerIdSchema, 'stranger');
const APP_SLUG = Value.Parse(DnsLabelSchema, 'pocketbase');
const PLATFORM = Value.Parse(HostnameSchema, 'pocketbase.apps.example.com');

const FIRST_TOKEN = 'sk-sealed-once';

// The column default, which nothing in the protocol names — five minutes.
const DEFAULT_IDLE_TIMEOUT_MS = 300_000;

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
    // The trigger on `auth."user"` has already made the profile, so this only sets the column.
    await sql.unsafe('UPDATE nibrun.profiles SET quota_apps_max_count = $2 WHERE owner_id = $1', [
      id,
      AMPLE,
    ]);
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

/**
 * More apps than the suite makes, granted to the owners it shares, so that a file whose apps
 * accumulate against one of them is not quietly testing the quota — the tests that are about it
 * bring owners of their own.
 */
const AMPLE = 100;

/** Every test creating an app wants one, so the quota refusal is the caller's to ask for. */
function requireCreated(created: AppCreation): CreatedApp {
  if (created.outcome !== 'created') {
    throw new Error(`The app was not created: ${created.outcome}.`);
  }
  return created;
}

/** An app of its own for whoever asks, so no test is holding a row another test is moving. */
async function createApp(slug: string): Promise<AppId> {
  const label = Value.Parse(DnsLabelSchema, slug);
  const created = requireCreated(
    await repo.create({
      anonymousAppsAtMost: null,
      ownerId: OWNER_ID,
      name: Value.Parse(AppNameSchema, slug),
      slug: label,
      hostname: Value.Parse(HostnameSchema, `${label}.apps.example.com`),
      config: { ...configWithDefaults(), environment: {} },
    }),
  );
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
 * The column's own default and nothing else: `create` names `owner_id` and `slug`, so what a new
 * app comes up as is decided by the migration rather than by anything a caller could pass.
 */
describe('an app nobody has said anything about waits to be asked for', () => {
  test('a new app runs on request, at the wait the column defaults to', async () => {
    const appId = await createApp('fresh-heron');

    expect(await repo.findById({ appId, ownerId: OWNER_ID })).toMatchObject({
      activation: 'on-request',
      idle_timeout_ms: DEFAULT_IDLE_TIMEOUT_MS,
    });
  });
});

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
    const created = requireCreated(
      await repo.create({
        anonymousAppsAtMost: null,
        ownerId: OWNER_ID,
        name: Value.Parse(AppNameSchema, APP_SLUG),
        slug: APP_SLUG,
        hostname: PLATFORM,
        config: {
          ...configWithDefaults(),
          environment: sealed({ TOKEN: FIRST_TOKEN, LOG_LEVEL: 'debug' }),
        },
      }),
    );
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
    return repo.update({ appId, ownerId, patch: { name: undefined, environment } });
  }

  function opened(value: string | undefined): string {
    return openSecret({ key: TEST_SECRETS_KEY, sealed: sealedFromStore(value ?? '') });
  }

  test('a patch that says nothing about the environment keeps all of it', async () => {
    const before = await storedEnvironment();

    await repo.update({ appId, ownerId, patch: { name: undefined, args: ['serve'] } });

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

  /**
   * The bounds are the one guarantee that outlives every caller. Both readings are a subtraction
   * on the guest's side — total less free, total less available — and a subtraction is what
   * produces a number below zero when the two ends come from different units. Nothing upstream
   * can write one of these today; a constraint is what keeps that true of what is added later.
   */
  describe('a reading the guest could not have taken is refused by the table', () => {
    function writeDirectly({ columns, values }: { columns: string; values: string }) {
      return () =>
        sql.unsafe(
          `INSERT INTO nibrun.app_usage (app_id, ${columns})
           SELECT id, ${values} FROM nibrun.apps LIMIT 1`,
        );
    }

    test('memory spent beyond what the guest has is not a reading', async () => {
      expect(
        await refusedBy(
          writeDirectly({
            columns: 'memory_total_bytes, memory_used_bytes, compute_measured_at',
            values: '100, 101, now()',
          }),
        ),
      ).toBe('app_usage_memory_within_itself');
    });

    test('memory spent below nothing is not a reading either', async () => {
      expect(
        await refusedBy(
          writeDirectly({
            columns: 'memory_total_bytes, memory_used_bytes, compute_measured_at',
            values: '100, -1, now()',
          }),
        ),
      ).toBe('app_usage_memory_within_itself');
    });

    test('a volume fuller than it is holds to the same rule', async () => {
      expect(
        await refusedBy(
          writeDirectly({
            columns: 'volume_total_bytes, volume_used_bytes, volume_measured_at',
            values: '100, 101, now()',
          }),
        ),
      ).toBe('app_usage_volume_within_itself');
    });

    // A rate is a rate: the agent clamps it, and this is what says so where it is stored.
    test('a share of more than every vCPU is not a share', async () => {
      expect(
        await refusedBy(
          writeDirectly({
            columns: 'memory_total_bytes, memory_used_bytes, cpu_share, compute_measured_at',
            values: '100, 10, 1.5, now()',
          }),
        ),
      ).toBe('app_usage_cpu_share_is_a_share');
    });

    // Half a reading is worse than none, because whoever reads one column reads all three.
    test('a family written without its moment is half a reading', async () => {
      expect(
        await refusedBy(
          writeDirectly({
            columns: 'memory_total_bytes, memory_used_bytes',
            values: '100, 10',
          }),
        ),
      ).toBe('app_usage_compute_whole');
    });
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

/**
 * The count and the insert are one transaction against a real database, and the quota comes from
 * a view over a profile a trigger made — neither is a thing a fake would answer the same way, so
 * this is exercised against Postgres.
 *
 * Owners of their own, because the ones the rest of the file shares are granted `AMPLE` so that
 * their apps can accumulate without the quota having an opinion.
 */
describe('an owner may have the apps they were given and no more', () => {
  const HOARDER_ID = Value.Parse(OwnerIdSchema, 'hoarder');
  const FRIEND_ID = Value.Parse(OwnerIdSchema, 'friend');

  /** What an owner nobody has said anything about gets, which is the free tier. */
  const BY_DEFAULT = 3;
  const GRANTED = 5;

  async function makeApp({ ownerId, slug }: { ownerId: OwnerId; slug: string }) {
    const label = Value.Parse(DnsLabelSchema, slug);
    const created = await repo.create({
      anonymousAppsAtMost: null,
      ownerId,
      name: Value.Parse(AppNameSchema, slug),
      slug: label,
      hostname: Value.Parse(HostnameSchema, `${label}.apps.example.com`),
      config: { ...configWithDefaults(), environment: {} },
    });
    return created.outcome;
  }

  beforeAll(async () => {
    for (const id of [HOARDER_ID, FRIEND_ID]) {
      await sql.unsafe(
        `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         VALUES ($1, $1, $2, true, now(), now())`,
        [id, `${id}@example.com`],
      );
    }
  });

  /** The column's default, reaching a create through the view rather than being read off the row. */
  test('an owner nobody has said anything about is on the free tier', async () => {
    expect(await repo.appsAllowed({ ownerId: HOARDER_ID })).toBe(BY_DEFAULT);
  });

  test('the app past the quota is declined rather than written', async () => {
    for (let made = 0; made < BY_DEFAULT; made++) {
      expect(await makeApp({ ownerId: HOARDER_ID, slug: `hoard-${made}` })).toBe('created');
    }

    expect(await makeApp({ ownerId: HOARDER_ID, slug: 'hoard-over' })).toBe('over-quota');
    expect(await repo.listByOwner({ ownerId: HOARDER_ID })).toHaveLength(BY_DEFAULT);
  });

  test('a deleted app gives its place back', async () => {
    const [first] = await repo.listByOwner({ ownerId: HOARDER_ID });
    if (!first) {
      throw new Error('The owner from the test above has no apps.');
    }
    await sql.unsafe(`UPDATE nibrun.apps SET state = 'deleted' WHERE id = $1`, [first.id]);

    expect(await makeApp({ ownerId: HOARDER_ID, slug: 'hoard-again' })).toBe('created');
  });

  /** A suspended app is one its owner can bring back, so it is one they are still holding. */
  test('a suspended app keeps its place', async () => {
    const [first] = await repo.listByOwner({ ownerId: HOARDER_ID });
    if (!first) {
      throw new Error('The owner from the test above has no apps.');
    }
    await sql.unsafe(`UPDATE nibrun.apps SET state = 'suspended' WHERE id = $1`, [first.id]);

    expect(await makeApp({ ownerId: HOARDER_ID, slug: 'hoard-suspended' })).toBe('over-quota');
  });

  /**
   * What the row lock in `create` is for, and the only thing that can show it: the count and the
   * insert are one decision, so requests arriving together must not each read the same count and
   * each find room for the app the others are making. Without the lock this owner ends up with
   * every app they asked for, whatever their quota says.
   */
  test('apps asked for at the same time cannot each take the same place', async () => {
    const RACER_ID = Value.Parse(OwnerIdSchema, 'racer');
    await sql.unsafe(
      `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $1, $2, true, now(), now())`,
      [RACER_ID, `${RACER_ID}@example.com`],
    );

    const attempts = [...Array(BY_DEFAULT * 2).keys()];
    const asked = await Promise.all(
      attempts.map((index) => makeApp({ ownerId: RACER_ID, slug: `racer-${index}` })),
    );

    expect(asked.filter((made) => made === 'created')).toHaveLength(BY_DEFAULT);
    expect(await repo.listByOwner({ ownerId: RACER_ID })).toHaveLength(BY_DEFAULT);
  });

  /** The whole point of the column: one owner is given more without moving anybody else. */
  test('a grant raises the number for the owner it names and nobody else', async () => {
    await sql.unsafe('UPDATE nibrun.profiles SET quota_apps_max_count = $2 WHERE owner_id = $1', [
      FRIEND_ID,
      GRANTED,
    ]);

    for (let made = 0; made < GRANTED; made++) {
      expect(await makeApp({ ownerId: FRIEND_ID, slug: `friend-${made}` })).toBe('created');
    }
    expect(await makeApp({ ownerId: FRIEND_ID, slug: 'friend-over' })).toBe('over-quota');

    expect(await repo.appsAllowed({ ownerId: FRIEND_ID })).toBe(GRANTED);
    expect(await repo.appsAllowed({ ownerId: HOARDER_ID })).toBe(BY_DEFAULT);
  });
});

/**
 * A name is what an owner calls an app and nothing the schema holds it to: the id is what an app
 * is known by, so two of theirs may share a name — exercised against Postgres because a
 * constraint's absence is only visible where one could be.
 */
describe('an app is called what its owner said, and so may another', () => {
  function makeApp({ ownerId, name, slug }: { ownerId: OwnerId; name: string; slug: string }) {
    const label = Value.Parse(DnsLabelSchema, slug);
    return repo.create({
      anonymousAppsAtMost: null,
      ownerId,
      name: Value.Parse(AppNameSchema, name),
      slug: label,
      hostname: Value.Parse(HostnameSchema, `${label}.apps.example.com`),
      config: { ...configWithDefaults(), environment: {} },
    });
  }

  test('an app is read back under the name it was given, which is not its slug', async () => {
    const created = requireCreated(
      await makeApp({ ownerId: OWNER_ID, name: 'My Blog', slug: 'my-blog-x7k2pq' }),
    );

    expect(created.app).toMatchObject({ name: 'My Blog', slug: 'my-blog-x7k2pq' });
    expect(await repo.findById({ appId: created.app.id, ownerId: OWNER_ID })).toMatchObject({
      name: 'My Blog',
      slug: 'my-blog-x7k2pq',
    });
  });

  test('a second app of theirs may be called the same', async () => {
    const again = requireCreated(
      await makeApp({ ownerId: OWNER_ID, name: 'My Blog', slug: 'my-blog-again' }),
    );

    expect(again.app).toMatchObject({ name: 'My Blog', slug: 'my-blog-again' });
    expect(
      (await repo.listByOwner({ ownerId: OWNER_ID })).filter((app) => app.name === 'My Blog'),
    ).toHaveLength(2);
  });

  describe('a rename moves the name and nothing else', () => {
    let appId: AppId;
    let before: Date;

    beforeAll(async () => {
      const created = requireCreated(
        await makeApp({ ownerId: OWNER_ID, name: 'Draft', slug: 'draft-p3nq7w' }),
      );
      appId = created.app.id;
      before = created.app.updated_at;
    });

    async function configVersions(): Promise<number> {
      const [row] = (await sql.unsafe(
        'SELECT count(*)::int AS versions FROM nibrun.app_configs WHERE app_id = $1',
        [appId],
      )) as Array<{ versions: number }>;
      return row?.versions ?? 0;
    }

    function rename({ name, ownerId }: { name: string; ownerId: OwnerId }) {
      return repo.update({ appId, ownerId, patch: { name: Value.Parse(AppNameSchema, name) } });
    }

    // Through the view, so this is also the check that the table's trigger still fires: an app
    // renamed is an app changed, and its owner is shown when.
    test('the app is read back under the new name, at the slug it had, and marked changed', async () => {
      const renamed = await rename({ name: 'Final', ownerId: OWNER_ID });

      expect(renamed).toMatchObject({ name: 'Final', slug: 'draft-p3nq7w' });
      expect(renamed?.updated_at.getTime()).toBeGreaterThan(before.getTime());
    });

    // A deployment pins a config version, so a rename that minted one would look like a release
    // waiting to be made.
    test('a rename appends no config version', async () => {
      const versions = await configVersions();

      await rename({ name: 'Final Again', ownerId: OWNER_ID });

      expect(await configVersions()).toBe(versions);
    });

    test('somebody else cannot rename it', async () => {
      expect(await rename({ name: 'Theirs', ownerId: STRANGER_ID })).toBeNull();
      expect(await repo.findById({ appId, ownerId: OWNER_ID })).toMatchObject({
        name: 'Final Again',
      });
    });
  });
});

/**
 * The deadline is decided in SQL from the profile, so the only place to see it reach an app is
 * the real schema: on every read an owner makes of their app, and in the listing the sweep reads.
 */
describe('an owner whose apps are given a lifetime is shown when each one ends', () => {
  const PASSERBY_ID = Value.Parse(OwnerIdSchema, 'passerby');
  const AN_HOUR_SECONDS = 3600;
  const MS_PER_SECOND = 1000;

  beforeAll(async () => {
    await sql.unsafe(
      `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $1, $2, true, now(), now())`,
      [PASSERBY_ID, `${PASSERBY_ID}@example.com`],
    );
    await sql.unsafe('UPDATE nibrun.profiles SET app_lifetime_seconds = $2 WHERE owner_id = $1', [
      PASSERBY_ID,
      AN_HOUR_SECONDS,
    ]);
  });

  test('an app of theirs carries its deadline on every read, an hour from its creation', async () => {
    const slug = Value.Parse(DnsLabelSchema, 'passing-tern');
    const created = requireCreated(
      await repo.create({
        anonymousAppsAtMost: null,
        ownerId: PASSERBY_ID,
        name: Value.Parse(AppNameSchema, slug),
        slug,
        hostname: Value.Parse(HostnameSchema, `${slug}.apps.example.com`),
        config: { ...configWithDefaults(), environment: {} },
      }),
    );
    const due = created.app.created_at.getTime() + AN_HOUR_SECONDS * MS_PER_SECOND;

    expect(created.app.expires_at?.getTime()).toBe(due);
    const found = await repo.findById({ appId: created.app.id, ownerId: PASSERBY_ID });
    expect(found?.expires_at?.getTime()).toBe(due);
    const listed = await repo.listByOwner({ ownerId: PASSERBY_ID });
    expect(listed.map((app) => app.expires_at?.getTime())).toEqual([due]);
  });

  test('an app of an owner who keeps theirs has none', async () => {
    const appId = await createApp('kept-tern');

    expect((await repo.findById({ appId, ownerId: OWNER_ID }))?.expires_at).toBeNull();
  });

  /** `created_at` is derived from the id, so an app past its hour is one whose id was minted there. */
  test('the sweep is handed each app past its deadline together with its owner', async () => {
    const [row] = (await sql.unsafe(
      `INSERT INTO nibrun.apps (id, owner_id, name, slug)
       VALUES (uuidv7('-2 hours'::interval), $1, 'passed-tern', 'passed-tern')
       RETURNING id`,
      [PASSERBY_ID],
    )) as Array<{ id: AppId }>;
    if (!row) {
      throw new Error('Inserting into nibrun.apps returned no row.');
    }

    expect(await repo.listExpirable({ limit: 10 })).toEqual([
      { app_id: row.id, owner_id: PASSERBY_ID },
    ]);
  });
});

/**
 * The one statement behind a stranger becoming somebody: it has to move every app, the deleted
 * ones included, because the key from an app to its owner refuses to let an owner go while any
 * row still names them — and the stranger is deleted the moment the move is done.
 */
describe('every app a stranger held changes hands at once', () => {
  const PASSERBY_ID = Value.Parse(OwnerIdSchema, 'passerby-claiming');
  const SOMEBODY_ID = Value.Parse(OwnerIdSchema, 'somebody');

  beforeAll(async () => {
    for (const id of [PASSERBY_ID, SOMEBODY_ID]) {
      await sql.unsafe(
        `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         VALUES ($1, $1, $2, true, now(), now())`,
        [id, `${id}@example.com`],
      );
    }
  });

  async function createFor(slug: string): Promise<AppId> {
    const label = Value.Parse(DnsLabelSchema, slug);
    const created = requireCreated(
      await repo.create({
        anonymousAppsAtMost: null,
        ownerId: PASSERBY_ID,
        name: Value.Parse(AppNameSchema, slug),
        slug: label,
        hostname: Value.Parse(HostnameSchema, `${label}.apps.example.com`),
        config: { ...configWithDefaults(), environment: {} },
      }),
    );
    return created.app.id;
  }

  test('the live ones and the deleted ones alike, and then the stranger can go', async () => {
    const kept = await createFor('kept-swift');
    const gone = await createFor('gone-swift');
    await sql.unsafe(`UPDATE nibrun.apps SET state = 'deleted' WHERE id = $1`, [gone]);
    const theirs = await createApp('theirs-swift');

    const moved = await repo.reassign({ from: PASSERBY_ID, to: SOMEBODY_ID });

    expect(moved.sort()).toEqual([kept, gone].sort());
    expect(await repo.findById({ appId: kept, ownerId: SOMEBODY_ID })).not.toBeNull();
    expect(await repo.findById({ appId: kept, ownerId: PASSERBY_ID })).toBeNull();
    expect(await repo.findById({ appId: theirs, ownerId: OWNER_ID })).not.toBeNull();
    await sql.unsafe('DELETE FROM auth."user" WHERE id = $1', [PASSERBY_ID]);
    expect(await repo.appsAllowed({ ownerId: PASSERBY_ID })).toBeNull();
  });

  test('a stranger who held nothing moves nothing', async () => {
    expect(await repo.reassign({ from: PASSERBY_ID, to: SOMEBODY_ID })).toEqual([]);
  });
});

/**
 * The count behind a stranger's app taking one binary and one deployment. What only the database
 * can show is the race: requests arriving together must not each count none and each take the
 * one place — which is what locking the app's row across the count and the insert is for.
 */
describe("a stranger's app takes one binary and one deployment", () => {
  const STRANGER_ID = Value.Parse(OwnerIdSchema, 'stranger-of-one');
  const ONLY_ONE = true;
  const ANY_NUMBER = false;
  const AT_ONCE = 6;
  const SHA256_HEX_LENGTH = 64;

  let artifacts: ArtifactsRepository;
  let deployments: DeploymentsRepository;

  beforeAll(async () => {
    await sql.unsafe(
      `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $1, $2, true, now(), now())`,
      [STRANGER_ID, `${STRANGER_ID}@example.com`],
    );
    await sql.unsafe('UPDATE nibrun.profiles SET quota_apps_max_count = $2 WHERE owner_id = $1', [
      STRANGER_ID,
      AMPLE,
    ]);
    artifacts = new ArtifactsRepository(withTypes<Queries>(sql));
    deployments = new DeploymentsRepository(withTypes<Queries>(sql));
  });

  async function createFor(slug: string): Promise<AppId> {
    const label = Value.Parse(DnsLabelSchema, slug);
    const created = requireCreated(
      await repo.create({
        anonymousAppsAtMost: null,
        ownerId: STRANGER_ID,
        name: Value.Parse(AppNameSchema, slug),
        slug: label,
        hostname: Value.Parse(HostnameSchema, `${label}.apps.example.com`),
        config: { ...configWithDefaults(), environment: {} },
      }),
    );
    return created.app.id;
  }

  function pending({ appId, onlyOne }: { appId: AppId; onlyOne: boolean }) {
    return artifacts.insertPending({
      appId,
      ownerId: STRANGER_ID,
      originalFileName: Value.Parse(FilenameSchema, 'server'),
      originalFileUrl: null,
      sourceDigest: null,
      onlyOne,
    });
  }

  /** A binary a deployment can name: the pending row completed with bytes nobody uploaded. */
  async function stored({ appId, digest }: { appId: AppId; digest: string }): Promise<ArtifactId> {
    const inserted = await pending({ appId, onlyOne: ANY_NUMBER });
    if (inserted.outcome !== 'created') {
      throw new Error('The artifact was not created.');
    }
    const row = await artifacts.complete({
      appId,
      artifactId: inserted.row.id,
      ownerId: STRANGER_ID,
      digest: Value.Parse(Sha256DigestSchema, digest),
      sizeBytes: 1,
      objectKey: Value.Parse(ObjectKeySchema, digest),
    });
    if (!row) {
      throw new Error('The artifact was not completed.');
    }
    return row.id;
  }

  test('a second binary is held, pending or not', async () => {
    const appId = await createFor('one-binary');

    expect((await pending({ appId, onlyOne: ONLY_ONE })).outcome).toBe('created');
    expect((await pending({ appId, onlyOne: ONLY_ONE })).outcome).toBe('held');
  });

  test('binaries asked for at the same time cannot each take the one place', async () => {
    const appId = await createFor('raced-binary');

    const asked = await Promise.all(
      [...Array(AT_ONCE).keys()].map(() => pending({ appId, onlyOne: ONLY_ONE })),
    );

    expect(asked.filter((one) => one.outcome === 'created')).toHaveLength(1);
  });

  test('an app that takes any number is not counted', async () => {
    const appId = await createFor('many-binaries');

    expect((await pending({ appId, onlyOne: ANY_NUMBER })).outcome).toBe('created');
    expect((await pending({ appId, onlyOne: ANY_NUMBER })).outcome).toBe('created');
  });

  test('a second deployment is held, whatever became of the first', async () => {
    const appId = await createFor('one-deployment');
    const artifactId = await stored({ appId, digest: 'a'.repeat(SHA256_HEX_LENGTH) });
    const deploy = () =>
      deployments.insert({
        appId,
        ownerId: STRANGER_ID,
        artifactId,
        initialDataFrom: null,
        onlyOne: ONLY_ONE,
      });

    expect((await deploy()).outcome).toBe('created');
    expect((await deploy()).outcome).toBe('held');
  });

  test('deployments asked for at the same time cannot each take the one place', async () => {
    const appId = await createFor('raced-deployment');
    const artifactId = await stored({ appId, digest: 'b'.repeat(SHA256_HEX_LENGTH) });

    const asked = await Promise.all(
      [...Array(AT_ONCE).keys()].map(() =>
        deployments.insert({
          appId,
          ownerId: STRANGER_ID,
          artifactId,
          initialDataFrom: null,
          onlyOne: ONLY_ONE,
        }),
      ),
    );

    expect(asked.filter((one) => one.outcome === 'created')).toHaveLength(1);
  });
});

/**
 * The count behind strangers holding so many apps between them and no more. What only the database
 * can show is the race: strangers arriving together must not each count the same number and each
 * take a place past the ceiling — which is what the advisory lock across the count and the insert
 * is for.
 *
 * What strangers hold is what has a deadline, so the owners here are given a lifetime rather than
 * signed in without an identity: the ceiling reads nibrun's own rows.
 */
describe('strangers hold so many apps between them and no more', () => {
  const CEILING = 2;
  const AT_ONCE = 6;
  const AN_HOUR_SECONDS = 3600;

  const strangers = ['first-stranger', 'second-stranger', 'third-stranger'].map((id) =>
    Value.Parse(OwnerIdSchema, id),
  );

  /** The apps with a deadline are what the ceiling counts, and the describes above left some. */
  function clearWhatStrangersHold(): Promise<unknown> {
    return sql.unsafe(
      `UPDATE nibrun.apps a SET state = 'deleted'
       FROM nibrun.profiles p
       WHERE p.owner_id = a.owner_id AND p.app_lifetime_seconds IS NOT NULL`,
    );
  }

  beforeAll(async () => {
    await clearWhatStrangersHold();
    for (const id of strangers) {
      await sql.unsafe(
        `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         VALUES ($1, $1, $2, true, now(), now())`,
        [id, `${id}@example.com`],
      );
      await sql.unsafe(
        'UPDATE nibrun.profiles SET quota_apps_max_count = $2, app_lifetime_seconds = $3 WHERE owner_id = $1',
        [id, AMPLE, AN_HOUR_SECONDS],
      );
    }
  });

  async function arrive({ ownerId, slug }: { ownerId: OwnerId; slug: string }) {
    const label = Value.Parse(DnsLabelSchema, slug);
    const created = await repo.create({
      ownerId,
      anonymousAppsAtMost: CEILING,
      name: Value.Parse(AppNameSchema, slug),
      slug: label,
      hostname: Value.Parse(HostnameSchema, `${label}.apps.example.com`),
      config: { ...configWithDefaults(), environment: {} },
    });
    return created.outcome;
  }

  test('the stranger past the ceiling is declined, whoever the others were', async () => {
    const [first, second, third] = strangers as [OwnerId, OwnerId, OwnerId];

    expect(await arrive({ ownerId: first, slug: 'ceiling-first' })).toBe('created');
    expect(await arrive({ ownerId: second, slug: 'ceiling-second' })).toBe('created');
    expect(await arrive({ ownerId: third, slug: 'ceiling-third' })).toBe('at-capacity');
  });

  /** The number is the platform's, so a person with an identity is not what it is counting. */
  test('an owner with an identity is not held to it', async () => {
    expect(await createApp('ceiling-somebody')).toBeDefined();
  });

  test('a place freed by an app going is a place the next stranger takes', async () => {
    const [first, , third] = strangers as [OwnerId, OwnerId, OwnerId];
    const [held] = await repo.listByOwner({ ownerId: first });
    if (!held) {
      throw new Error('The stranger from the test above has no app.');
    }
    await sql.unsafe(`UPDATE nibrun.apps SET state = 'deleted' WHERE id = $1`, [held.id]);

    expect(await arrive({ ownerId: third, slug: 'ceiling-freed' })).toBe('created');
  });

  test('strangers arriving at the same time cannot each take a place past the ceiling', async () => {
    await clearWhatStrangersHold();
    const [first] = strangers as [OwnerId, OwnerId, OwnerId];

    const asked = await Promise.all(
      [...Array(AT_ONCE).keys()].map((index) =>
        arrive({ ownerId: first, slug: `ceiling-raced-${index}` }),
      ),
    );

    expect(asked.filter((one) => one === 'created')).toHaveLength(CEILING);
  });
});
