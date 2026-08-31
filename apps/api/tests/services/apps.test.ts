import { describe, expect, test } from 'bun:test';
import {
  type AppActivation,
  type AppId,
  AppIdSchema,
  type AppState,
  type ComputeUsage,
  type DnsLabel,
  DnsLabelSchema,
  type FilesystemUsage,
  type Hostname,
  HostnameSchema,
  MIN_IDLE_TIMEOUT_MS,
  type ObjectKey,
  ObjectKeySchema,
  OWNED_APP_STATES,
  type OwnerId,
  REDACTED,
  type ReportedInstance,
  type ReportedVolume,
  type TenantEnvironment,
  type TenantEnvironmentPatch,
  TenantEnvironmentPatchSchema,
  TenantEnvironmentSchema,
  TimestampSchema,
  Value,
  VolumeIdSchema,
} from '@repo/protocol';
import { SQL } from 'bun';
import { schema } from '#db/queries.gen.ts';
import type {
  NewAppConfig,
  PublicAppConfig,
  SealedConfigPatch,
  StoredAppConfig,
} from '#lib/app-config.ts';
import { BadRequestError, ConflictError, NotFoundError } from '#lib/errors.ts';
import { openSecret, sealedFromStore } from '#lib/tenant-secrets.ts';
import type {
  AppHostnameRow,
  DisposableAppHostnameRow,
  OwnedAppHostnameRow,
} from '#repositories/app-hostnames.repository.ts';
import type {
  ActivationChange,
  AppRow,
  AppsRepositoryContract,
  CreatedApp,
  Leftovers,
  StateChange,
} from '#repositories/apps.repository.ts';
import {
  type AppHostnameAccess,
  AppsService,
  type CustomHostnameRemoval,
  type ExportCancellation,
  type ObjectRemoval,
} from '#services/apps.service.ts';
import {
  APP_HOST_DOMAIN,
  APP_ID,
  configColumns,
  DEFAULT_CONFIG,
  DEFAULT_STORED_CONFIG,
  DEPLOYMENT_ID,
  OWNER_ID,
} from '#tests/services/support/fixtures.ts';
import { uniqueViolation } from '#tests/support/postgres.ts';
import { TEST_SECRETS_KEY } from '#tests/support/secrets.ts';

const SECRET = 'sk-not-in-any-response';

// The branded records a controller parses before the service ever sees one: the whole of an
// environment for an app being created, and an edit to one for an app that exists.
function asEnvironment(entries: Record<string, string>): TenantEnvironment {
  return Value.Parse(TenantEnvironmentSchema, entries);
}

function asPatch(entries: Record<string, string | null>): TenantEnvironmentPatch {
  return Value.Parse(TenantEnvironmentPatchSchema, entries);
}

const APP_NAME = 'pocketbase';
const BROUGHT_HOSTNAME = Value.Parse(HostnameSchema, 'pocketbase.example.dev');
const CLOUDFLARE_ID = 'ch-1';

// Restated rather than imported from the implementation: that the bound exists and how many
// rolls it allows is the contract this file holds the service to.
const MAX_SLUG_ATTEMPTS = 5;

const COLLISIONS_BEFORE_SUCCESS = 2;

function distinct(slugs: readonly DnsLabel[]): number {
  return new Set(slugs).size;
}

// What the column defaults to, which is what every app that has never been told otherwise has.
const STORED_IDLE_TIMEOUT_MS = 900_000;

function appRow(slug: DnsLabel): AppRow {
  return {
    id: APP_ID,
    owner_id: OWNER_ID,
    slug,
    state: 'active',
    activation: 'always',
    idle_timeout_ms: STORED_IDLE_TIMEOUT_MS,
    created_at: new Date(),
    updated_at: new Date(),
    volume_total_bytes: null,
    volume_used_bytes: null,
    volume_measured_at: null,
    memory_total_bytes: null,
    memory_used_bytes: null,
    cpu_share: null,
    compute_measured_at: null,
    ...configColumns(DEFAULT_CONFIG),
  };
}

/**
 * Records every slug it is offered and rejects the first `failures` of them, so a test can ask
 * what the service did rather than how it did it. Every read answers empty until `owns` says the
 * app is this owner's, which is what an app belonging to somebody else looks like.
 */
class StubAppsRepository implements AppsRepositoryContract {
  readonly offeredSlugs: DnsLabel[] = [];
  readonly offeredConfigs: StoredAppConfig[] = [];
  readonly offeredPatches: SealedConfigPatch[] = [];
  readonly deleted: AppId[] = [];
  readonly trace: string[] = [];
  readonly leftovers = new Map<AppId, Leftovers>();
  readonly measured: ReadonlyMap<AppId, FilesystemUsage>[] = [];
  readonly spending: ReadonlyMap<AppId, ComputeUsage>[] = [];
  readonly forgotten: AppId[][] = [];
  deleting: AppId[] = [];
  purgeable: AppId[] = [];
  deployedApps: AppId[] = [];
  owns = false;
  #remainingFailures: number;
  readonly #failure: unknown;

  constructor({ failures, failure }: { failures: number; failure?: unknown }) {
    this.#remainingFailures = failures;
    this.#failure = failure;
  }

  // A deletion is finishable when the app is going and no host holds a volume for it, which is
  // to say it was never deployed. The view says both halves; this says them the same way.
  #finishable(appId: AppId): boolean {
    return this.deleting.includes(appId) && !this.deployedApps.includes(appId);
  }

  isDeletionFinishable({ appId }: { appId: AppId }): Promise<boolean> {
    return Promise.resolve(this.#finishable(appId));
  }

  listFinishableDeletions({ limit }: { limit: number }): Promise<AppId[]> {
    return Promise.resolve(
      this.deleting.filter((appId) => this.#finishable(appId)).slice(0, limit),
    );
  }

  finishDeleting({ appId }: { appId: AppId }): Promise<boolean> {
    if (!this.deleting.includes(appId)) {
      return Promise.resolve(false);
    }
    this.deleting = this.deleting.filter((id) => id !== appId);
    this.deleted.push(appId);
    return Promise.resolve(true);
  }

  create({
    slug,
    hostname,
    config,
  }: {
    ownerId: OwnerId;
    slug: DnsLabel;
    hostname: Hostname;
    config: StoredAppConfig;
  }): Promise<CreatedApp> {
    this.offeredSlugs.push(slug);
    this.offeredConfigs.push(config);
    if (this.#remainingFailures > 0) {
      this.#remainingFailures--;
      return Promise.reject(this.#failure);
    }
    return Promise.resolve({
      app: { ...appRow(slug), ...configColumns(config) },
      hostnames: [{ hostname, kind: 'platform', state: 'active', dcv_target: null }],
    });
  }

  isOwnedBy(): Promise<boolean> {
    return Promise.resolve(this.owns);
  }

  listByOwner(): Promise<AppRow[]> {
    return Promise.resolve([]);
  }

  /** The config an app already has, for a service that reads it before deciding about an edit. */
  current: PublicAppConfig = DEFAULT_CONFIG;

  #reads = 0;

  /** How many times the current config was read, so a check can be shown not to cost one. */
  get reads(): number {
    return this.#reads;
  }

  findById(): Promise<AppRow | null> {
    this.#reads++;
    if (!this.owns) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      ...appRow(Value.Parse(DnsLabelSchema, APP_NAME)),
      ...configColumns(this.current),
    });
  }

  recordVolumeUsage({
    readings,
  }: {
    readings: ReadonlyMap<AppId, FilesystemUsage>;
  }): Promise<void> {
    this.measured.push(new Map(readings));
    return Promise.resolve();
  }

  recordComputeUsage({ readings }: { readings: ReadonlyMap<AppId, ComputeUsage> }): Promise<void> {
    this.spending.push(new Map(readings));
    return Promise.resolve();
  }

  clearComputeUsage({ appIds }: { appIds: readonly AppId[] }): Promise<void> {
    this.forgotten.push([...appIds]);
    return Promise.resolve();
  }

  updateConfig({
    patch,
  }: {
    appId: AppId;
    ownerId: OwnerId;
    patch: SealedConfigPatch;
  }): Promise<AppRow | null> {
    this.offeredPatches.push(patch);
    return Promise.resolve(this.owns ? appRow(Value.Parse(DnsLabelSchema, APP_NAME)) : null);
  }

  updateState({ appId, state, from }: StateChange): Promise<AppRow | null> {
    if (!this.owns) {
      return Promise.resolve(null);
    }
    // The predicate the real statement carries, said the same way: an app in none of the states
    // the caller named is one it does not touch.
    if (!from.includes(this.#stateOf(appId))) {
      return Promise.resolve(null);
    }
    // The state the app is left in is what `finishDeleting` then has to find, so it is recorded
    // rather than only returned.
    if (state === 'deleting') {
      this.deleting.push(appId);
    }
    return Promise.resolve({ ...appRow(Value.Parse(DnsLabelSchema, APP_NAME)), state });
  }

  /** How the app comes up now, which a patch edits rather than replaces. */
  activation: AppActivation = 'always';
  idleTimeoutMs = STORED_IDLE_TIMEOUT_MS;

  updateActivation({ appId, patch, from }: ActivationChange): Promise<AppRow | null> {
    if (!this.owns || !from.includes(this.#stateOf(appId))) {
      return Promise.resolve(null);
    }
    // `COALESCE` said the same way: a field the patch is silent about keeps what it had.
    this.activation = patch.activation ?? this.activation;
    this.idleTimeoutMs = patch.idleTimeoutMs ?? this.idleTimeoutMs;
    return Promise.resolve({
      ...appRow(Value.Parse(DnsLabelSchema, APP_NAME)),
      activation: this.activation,
      idle_timeout_ms: this.idleTimeoutMs,
    });
  }

  #stateOf(appId: AppId): AppState {
    if (this.deleted.includes(appId)) {
      return 'deleted';
    }
    return this.deleting.includes(appId) ? 'deleting' : 'active';
  }

  listPurgeable({ limit }: { limit: number }): Promise<AppId[]> {
    return Promise.resolve(this.purgeable.slice(0, limit));
  }

  listLeftovers({ appId }: { appId: AppId }): Promise<Leftovers> {
    return Promise.resolve(this.leftovers.get(appId) ?? { artifacts: [], exports: [] });
  }

  // An app leaves the purgeable list by having nothing left, which is how the real view answers.
  purge({ appId }: { appId: AppId }): Promise<void> {
    this.trace.push(`rows:${appId}`);
    this.purgeable = this.purgeable.filter((id) => id !== appId);
    return Promise.resolve();
  }
}

/**
 * Both buckets write into one trace, because what this has to pin down is that no object is
 * deleted after the row naming it: a bucket refusing a delete has to leave work a later pass can
 * still find.
 */
/** Every read answers empty, which is what an app belonging to somebody else looks like. */
class StubHostnameAccess implements AppHostnameAccess {
  readonly disposable = new Map<AppId, DisposableAppHostnameRow[]>();
  readonly removed: Hostname[] = [];

  listByOwner(): Promise<OwnedAppHostnameRow[]> {
    return Promise.resolve([]);
  }

  listByApp(): Promise<AppHostnameRow[]> {
    return Promise.resolve([]);
  }

  listDisposable({ appId }: { appId: AppId }): Promise<DisposableAppHostnameRow[]> {
    return Promise.resolve(this.disposable.get(appId) ?? []);
  }

  removeDisposable({ appId, hostname }: { appId: AppId; hostname: Hostname }): Promise<boolean> {
    const before = this.disposable.get(appId) ?? [];
    const after = before.filter((row) => row.hostname !== hostname);
    this.disposable.set(appId, after);
    if (before.length === after.length) {
      return Promise.resolve(false);
    }
    this.removed.push(hostname);
    return Promise.resolve(true);
  }
}

class StubCustomHostnameRemoval implements CustomHostnameRemoval {
  readonly removed: string[] = [];
  readonly failures = new Set<string>();

  remove({ cloudflareId }: { cloudflareId: string }): Promise<void> {
    if (this.failures.has(cloudflareId)) {
      return Promise.reject(new Error(`the edge refused ${cloudflareId}`));
    }
    this.removed.push(cloudflareId);
    return Promise.resolve();
  }
}

class StubObjectStorage {
  readonly removed: ObjectKey[] = [];
  readonly #trace: string[];
  readonly #refuse: ReadonlySet<ObjectKey>;

  constructor({
    trace,
    refuse = new Set<ObjectKey>(),
  }: { trace: string[]; refuse?: Set<ObjectKey> }) {
    this.#trace = trace;
    this.#refuse = refuse;
  }

  remove({ objectKey }: { objectKey: ObjectKey }): Promise<void> {
    if (this.#refuse.has(objectKey)) {
      return Promise.reject(new Error(`the bucket refused ${objectKey}`));
    }
    this.#trace.push(`object:${objectKey}`);
    this.removed.push(objectKey);
    return Promise.resolve();
  }
}

function objectKey(key: string): ObjectKey {
  return Value.Parse(ObjectKeySchema, key);
}

const VOLUME_ID = Value.Parse(VolumeIdSchema, APP_ID);
const NO_BYTES = 0;

class StubExportCancellation implements ExportCancellation {
  readonly cancelled: AppId[] = [];

  failInFlight({ appId }: { appId: AppId; message: string }): Promise<void> {
    this.cancelled.push(appId);
    return Promise.resolve();
  }
}

function serviceWith({
  appsRepo,
  hostnamesRepo = new StubHostnameAccess(),
  customHostnamesRepo = new StubCustomHostnameRemoval(),
  exportsRepo = new StubExportCancellation(),
  artifactStorageRepo = new StubObjectStorage({ trace: [] }),
  exportStorageRepo = new StubObjectStorage({ trace: [] }),
}: {
  appsRepo: AppsRepositoryContract;
  hostnamesRepo?: AppHostnameAccess;
  customHostnamesRepo?: CustomHostnameRemoval;
  exportsRepo?: ExportCancellation;
  artifactStorageRepo?: ObjectRemoval;
  exportStorageRepo?: ObjectRemoval;
}) {
  return new AppsService({
    appsRepo,
    hostnamesRepo,
    customHostnamesRepo,
    exportsRepo,
    artifactStorageRepo,
    exportStorageRepo,
    appHostDomain: APP_HOST_DOMAIN,
    secretsKey: TEST_SECRETS_KEY,
  });
}

function createApp({
  appsRepo,
  config,
}: {
  appsRepo: AppsRepositoryContract;
  config?: NewAppConfig;
}) {
  return serviceWith({ appsRepo }).create({ ownerId: OWNER_ID, name: APP_NAME, config });
}

describe('a taken hostname is a re-roll, not something the owner sees', () => {
  test('a collision produces a second attempt carrying fresh entropy', async () => {
    const appsRepo = new StubAppsRepository({
      failures: 1,
      failure: uniqueViolation(schema.apps._indexes.apps_slug_key._indexName),
    });

    const app = await createApp({ appsRepo });

    expect(appsRepo.offeredSlugs).toHaveLength(2);
    // The name survives the re-roll; only the entropy moves.
    expect(appsRepo.offeredSlugs.every((slug) => slug.startsWith(`${APP_NAME}-`))).toBe(true);
    expect(distinct(appsRepo.offeredSlugs)).toBe(2);
    // The app answers to the label that was accepted, not to the one that was refused.
    expect(app.slug).toBe(Value.Parse(DnsLabelSchema, appsRepo.offeredSlugs[1]));
  });

  // The hostname is unique platform-wide, so a collision on either constraint means the same
  // thing and both have to be retried.
  test('a collision on the hostname is retried just like one on the slug', async () => {
    const appsRepo = new StubAppsRepository({
      failures: COLLISIONS_BEFORE_SUCCESS,
      failure: uniqueViolation(schema.app_hostnames._indexes.app_hostnames_hostname_key._indexName),
    });

    const app = await createApp({ appsRepo });

    expect(appsRepo.offeredSlugs).toHaveLength(COLLISIONS_BEFORE_SUCCESS + 1);
    expect(distinct(appsRepo.offeredSlugs)).toBe(appsRepo.offeredSlugs.length);
    expect(app.hostnames).toEqual([
      {
        hostname: Value.Parse(HostnameSchema, `${app.slug}.${APP_HOST_DOMAIN}`),
        kind: 'platform',
        state: 'active',
        dcvTarget: null,
      },
    ]);
  });
});

describe('retrying is bounded, and only covers collisions', () => {
  test('an unbroken run of collisions is surfaced instead of retried forever', async () => {
    const appsRepo = new StubAppsRepository({
      failures: Number.POSITIVE_INFINITY,
      failure: uniqueViolation(schema.apps._indexes.apps_slug_key._indexName),
    });

    await expect(createApp({ appsRepo })).rejects.toBeInstanceOf(ConflictError);
    expect(appsRepo.offeredSlugs).toHaveLength(MAX_SLUG_ATTEMPTS);
  });

  // Retrying a violation fresh entropy cannot fix would spend every attempt on the same failure
  // and then report a hostname conflict that never happened.
  test('a unique violation on another constraint is not a collision', async () => {
    const appsRepo = new StubAppsRepository({
      failures: 1,
      failure: uniqueViolation('some_other_key'),
    });

    await expect(createApp({ appsRepo })).rejects.toBeInstanceOf(SQL.PostgresError);
    expect(appsRepo.offeredSlugs).toHaveLength(1);
  });

  test('an error that is not a unique violation propagates untouched', async () => {
    const failure = new Error('connection terminated unexpectedly');
    const appsRepo = new StubAppsRepository({ failures: 1, failure });

    await expect(createApp({ appsRepo })).rejects.toThrow(failure);
    expect(appsRepo.offeredSlugs).toHaveLength(1);
  });
});

describe('an app is created with the environment it was given, and never reports a value', () => {
  test('a partial config is completed from the protocol defaults', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });

    await createApp({ appsRepo, config: { args: ['serve'] } });

    expect(appsRepo.offeredConfigs).toEqual([{ ...DEFAULT_STORED_CONFIG, args: ['serve'] }]);
  });

  test('what reaches the database is sealed, never the value that was given', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });

    await createApp({ appsRepo, config: { environment: asEnvironment({ TOKEN: SECRET }) } });

    const stored = appsRepo.offeredConfigs[0]?.environment ?? {};
    expect(Object.keys(stored)).toEqual(['TOKEN']);
    expect(stored.TOKEN).not.toContain(SECRET);
    expect(openSecret({ key: TEST_SECRETS_KEY, sealed: sealedFromStore(stored.TOKEN ?? '') })).toBe(
      SECRET,
    );
  });

  test('an unconfigured app falls back to the defaults the protocol publishes', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });

    await createApp({ appsRepo });

    expect(appsRepo.offeredConfigs).toEqual([DEFAULT_STORED_CONFIG]);
  });

  // An owner has to be told which variables are set without being told what they hold, which is
  // the whole reason the names are stored in the clear and the values are not.
  test('the wire names every variable and returns none of them', async () => {
    const app = await createApp({
      appsRepo: new StubAppsRepository({ failures: 0 }),
      config: { environment: asEnvironment({ TOKEN: SECRET }) },
    });

    expect(app.config.environment).toEqual({ TOKEN: REDACTED });
    expect(JSON.stringify(app.config)).not.toContain(SECRET);
  });
});

describe('an app asks for a public port besides HTTP, and is never handed one it did not', () => {
  test('an app that asks has it recorded', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });

    await createApp({ appsRepo, config: { hasExtraPublicPort: true } });

    expect(appsRepo.offeredConfigs).toEqual([
      { ...DEFAULT_STORED_CONFIG, hasExtraPublicPort: true },
    ]);
  });

  // Absent rather than false: the repository carries forward what a patch says nothing about, so
  // an edit to something else must not be able to take the port away.
  test('a patch about something else says nothing about it', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    appsRepo.owns = true;

    await serviceWith({ appsRepo }).updateConfig({
      appId: APP_ID,
      ownerId: OWNER_ID,
      patch: { args: ['serve'] },
    });

    expect('hasExtraPublicPort' in (appsRepo.offeredPatches[0] ?? {})).toBe(false);
  });

  test('a patch giving one up carries the answer rather than the silence', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    appsRepo.owns = true;

    await serviceWith({ appsRepo }).updateConfig({
      appId: APP_ID,
      ownerId: OWNER_ID,
      patch: { hasExtraPublicPort: false },
    });

    expect(appsRepo.offeredPatches[0]?.hasExtraPublicPort).toBe(false);
  });
});

/**
 * The guest is given these two only for an app that asked for a public port, and fails the boot on
 * a reference it was not given. Refused here, a variable costs a sentence rather than a deploy that
 * never serves and says why only in the instance's console.
 */
describe('a value may name the port an app has, and not one it has not', () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the syntax being validated, not an interpolation
  const ANNOUNCED = 'ANNOUNCED_IP=${NIBRUN_PUBLIC_IPV4}';
  const [, ADDRESS = ''] = ANNOUNCED.split('=');

  test('an app created without a port cannot name one', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });

    await expect(
      createApp({ appsRepo, config: { environment: asEnvironment({ ANNOUNCED_IP: ADDRESS }) } }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  test('an app created with one may', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });

    await createApp({
      appsRepo,
      config: {
        hasExtraPublicPort: true,
        environment: asEnvironment({ ANNOUNCED_IP: ADDRESS }),
      },
    });

    expect(appsRepo.offeredConfigs).toHaveLength(1);
  });

  // The port the edit leaves behind, not the one it carries: naming one is allowed by an app that
  // already had it.
  test('a patch may name the port the app already has', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    appsRepo.owns = true;
    appsRepo.current = { ...DEFAULT_CONFIG, hasExtraPublicPort: true };

    await serviceWith({ appsRepo }).updateConfig({
      appId: APP_ID,
      ownerId: OWNER_ID,
      patch: { environment: asPatch({ ANNOUNCED_IP: ADDRESS }) },
    });

    expect(appsRepo.offeredPatches).toHaveLength(1);
  });

  test('a patch naming one the app does not have is refused', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    appsRepo.owns = true;

    await expect(
      serviceWith({ appsRepo }).updateConfig({
        appId: APP_ID,
        ownerId: OWNER_ID,
        patch: { environment: asPatch({ ANNOUNCED_IP: ADDRESS }) },
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(appsRepo.offeredPatches).toEqual([]);
  });

  test('one edit may ask for the port and name it at once', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    appsRepo.owns = true;

    await serviceWith({ appsRepo }).updateConfig({
      appId: APP_ID,
      ownerId: OWNER_ID,
      patch: { hasExtraPublicPort: true, environment: asPatch({ ANNOUNCED_IP: ADDRESS }) },
    });

    expect(appsRepo.offeredPatches).toHaveLength(1);
    // The edit answers the question itself, so there is nothing to go and look up.
    expect(appsRepo.reads).toBe(0);
  });

  test('a patch naming none of them is the one write it was', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    appsRepo.owns = true;

    await serviceWith({ appsRepo }).updateConfig({
      appId: APP_ID,
      ownerId: OWNER_ID,
      patch: { environment: asPatch({ TOKEN: SECRET }) },
    });

    expect(appsRepo.reads).toBe(0);
  });
});

describe('a config patch edits the environment rather than replacing it', () => {
  test('a patch that says nothing about it carries no environment at all', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    appsRepo.owns = true;
    const service = serviceWith({ appsRepo });

    await service.updateConfig({ appId: APP_ID, ownerId: OWNER_ID, patch: { args: ['serve'] } });

    // Absent rather than empty: the repository reads absence as "carry every variable forward",
    // and there is no shape of empty that means anything else.
    expect('environment' in (appsRepo.offeredPatches[0] ?? {})).toBe(false);
  });

  test('a patch setting one seals the value and takes nothing away', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    appsRepo.owns = true;
    const service = serviceWith({ appsRepo });

    await service.updateConfig({
      appId: APP_ID,
      ownerId: OWNER_ID,
      patch: { environment: asPatch({ TOKEN: SECRET }) },
    });

    const environment = appsRepo.offeredPatches[0]?.environment;
    expect(
      openSecret({ key: TEST_SECRETS_KEY, sealed: sealedFromStore(environment?.set.TOKEN ?? '') }),
    ).toBe(SECRET);
    expect(environment?.removed).toEqual([]);
  });

  // The name and nothing else: an empty value is a value, so saying a variable should go cannot
  // be done by giving it one.
  test('a variable is removed by naming it with no value', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    appsRepo.owns = true;
    const service = serviceWith({ appsRepo });

    await service.updateConfig({
      appId: APP_ID,
      ownerId: OWNER_ID,
      patch: { environment: asPatch({ TOKEN: null }) },
    });

    expect(appsRepo.offeredPatches[0]?.environment).toEqual({ set: {}, removed: ['TOKEN'] });
  });

  test('the two halves of one patch reach the repository apart', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    appsRepo.owns = true;
    const service = serviceWith({ appsRepo });

    await service.updateConfig({
      appId: APP_ID,
      ownerId: OWNER_ID,
      patch: { environment: asPatch({ TOKEN: SECRET, GONE: null }) },
    });

    const environment = appsRepo.offeredPatches[0]?.environment;
    expect(Object.keys(environment?.set ?? {})).toEqual(['TOKEN']);
    expect(environment?.removed).toEqual(['GONE']);
  });
});

/**
 * `[redacted]` is what an owner reads in place of every value, so a caller sending it as one is
 * echoing what it read rather than setting anything. Stored, it would overwrite the secret with
 * the word and leave the app running on it, with nothing said.
 */
describe('the placeholder a read returns cannot be set as a value', () => {
  test('a patch carrying it is refused before anything is sealed', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    appsRepo.owns = true;
    const service = serviceWith({ appsRepo });

    await expect(
      service.updateConfig({
        appId: APP_ID,
        ownerId: OWNER_ID,
        patch: { environment: asPatch({ TOKEN: REDACTED }) },
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(appsRepo.offeredPatches).toHaveLength(0);
  });

  test('and so is an app created with it', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });

    await expect(
      createApp({ appsRepo, config: { environment: asEnvironment({ TOKEN: REDACTED }) } }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(appsRepo.offeredConfigs).toHaveLength(0);
  });
});

// A 403 would confirm the app exists to someone with no right to know it does.
describe('an app the caller does not own is one that does not exist', () => {
  test('a statement that matches no row is a 404', async () => {
    const service = serviceWith({ appsRepo: new StubAppsRepository({ failures: 0 }) });
    const owned = { appId: APP_ID, ownerId: OWNER_ID };

    await expect(service.get(owned)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.updateConfig({ ...owned, patch: {} })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(service.delete(owned)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.setState({ ...owned, state: 'suspended' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(service.setActivation({ ...owned, patch: {} })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

/**
 * On the app rather than on the config a deployment pins, so this is one write and the next poll:
 * nothing is deployed, no release is replaced, and a rollback cannot replay a policy from months
 * ago. What this has to get right is the row and what an edit leaves alone.
 */
describe('how an app comes up is changed without deploying anything', () => {
  const owned = { appId: APP_ID, ownerId: OWNER_ID };

  test('an owner turns the saving on and says how long a quiet spell is', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    appsRepo.owns = true;

    const app = await serviceWith({ appsRepo }).setActivation({
      ...owned,
      patch: { activation: 'on-request', idleTimeoutMs: MIN_IDLE_TIMEOUT_MS },
    });

    expect(app).toMatchObject({
      activation: 'on-request',
      idleTimeoutMs: MIN_IDLE_TIMEOUT_MS,
    });
  });

  // The timeout is kept for every app, so turning the saving off is not a way to lose it.
  test('turning it off again leaves the timeout the owner chose', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    appsRepo.owns = true;
    const service = serviceWith({ appsRepo });

    await service.setActivation({
      ...owned,
      patch: { activation: 'on-request', idleTimeoutMs: MIN_IDLE_TIMEOUT_MS },
    });
    const app = await service.setActivation({ ...owned, patch: { activation: 'always' } });

    expect(app).toMatchObject({ activation: 'always', idleTimeoutMs: MIN_IDLE_TIMEOUT_MS });
  });

  // A teardown is not something a policy change can call off, and an app on its way out has no
  // activation worth having.
  test('an app being deleted is refused rather than reconfigured', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    appsRepo.owns = true;
    appsRepo.deleting = [APP_ID];

    await expect(
      serviceWith({ appsRepo }).setActivation({ ...owned, patch: { activation: 'on-request' } }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

/**
 * Nothing is stopped from here. The app being anything other than `active` is what its desired
 * instance state is read from, so what this has to get right is the row and what it refuses.
 */
describe('an app is suspended by saying so, and comes back the release it left as', () => {
  const owned = { appId: APP_ID, ownerId: OWNER_ID };

  for (const state of OWNED_APP_STATES) {
    test(`an owner moves their app to ${state}`, async () => {
      const appsRepo = new StubAppsRepository({ failures: 0 });
      appsRepo.owns = true;

      const app = await serviceWith({ appsRepo }).setState({ ...owned, state });

      expect(app.state).toBe(state);
    });
  }

  // The teardown is already running and there is nothing to bring back to: a volume the host has
  // been told to remove is not one an app can be resumed onto.
  test('an app being deleted is refused rather than brought back', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    appsRepo.owns = true;
    appsRepo.deleting = [APP_ID];

    await expect(
      serviceWith({ appsRepo }).setState({ ...owned, state: 'active' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

/**
 * Deleting is asked for here and finished on the host that holds the data, so nothing below
 * calls an app deleted while a tenant's bytes are still on a disk somewhere.
 */
describe('an app is deleted when its filesystem is gone, not when it is asked for', () => {
  function reportedVolume(state: ReportedVolume['state']): ReportedVolume {
    return { volumeId: VOLUME_ID, appId: APP_ID, state, sizeBytes: NO_BYTES };
  }

  test('asking leaves an app with a filesystem deleting rather than deleted', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    appsRepo.owns = true;
    appsRepo.deployedApps = [APP_ID];

    const app = await serviceWith({ appsRepo }).delete({ appId: APP_ID, ownerId: OWNER_ID });

    expect(app.state).toBe('deleting');
    expect(appsRepo.deleted).toEqual([]);
  });

  // The bundle would be reachable only through the app that is going, and the host would spend
  // minutes reading a filesystem the same reconcile pass tears down.
  test('an export still being written is ended rather than left to finish', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    appsRepo.owns = true;
    const exportsRepo = new StubExportCancellation();

    await serviceWith({ appsRepo, exportsRepo }).delete({ appId: APP_ID, ownerId: OWNER_ID });

    expect(exportsRepo.cancelled).toEqual([APP_ID]);
  });

  // Reached only by an owner the app answered to: the state change is what says it is theirs.
  test('and an app the caller does not own has none of its exports touched', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    const exportsRepo = new StubExportCancellation();

    await expect(
      serviceWith({ appsRepo, exportsRepo }).delete({ appId: APP_ID, ownerId: OWNER_ID }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(exportsRepo.cancelled).toEqual([]);
  });

  test('a host saying the filesystem is gone is what finishes it', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    appsRepo.deleting = [APP_ID];

    await serviceWith({ appsRepo }).completeDeletions({ volumes: [reportedVolume('deleted')] });

    expect(appsRepo.deleted).toEqual([APP_ID]);
  });

  // A volume the host still holds is one whose app is not deleted, however long it has been
  // asked for — `deleting` on the app is a request, not an outcome.
  const held: ReportedVolume['state'][] = ['ready', 'detached', 'pending', 'failed'];
  for (const state of held) {
    test(`a volume the host reports as ${state} leaves the app where it is`, async () => {
      const appsRepo = new StubAppsRepository({ failures: 0 });
      appsRepo.deleting = [APP_ID];

      await serviceWith({ appsRepo }).completeDeletions({ volumes: [reportedVolume(state)] });

      expect(appsRepo.deleted).toEqual([]);
    });
  }

  // The host keeps reporting the volume until desired state stops naming it, so this arrives
  // many times for one deletion.
  test('the same report arriving again deletes nothing a second time', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    appsRepo.deleting = [APP_ID];
    const apps = serviceWith({ appsRepo });

    await apps.completeDeletions({ volumes: [reportedVolume('deleted')] });
    await apps.completeDeletions({ volumes: [reportedVolume('deleted')] });

    expect(appsRepo.deleted).toEqual([APP_ID]);
  });

  // Nothing asked for this one to go, so a host that lost a filesystem must not be able to
  // delete the app that owns it.
  test('an app nobody asked to delete survives its volume going missing', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });

    await serviceWith({ appsRepo }).completeDeletions({ volumes: [reportedVolume('deleted')] });

    expect(appsRepo.deleted).toEqual([]);
  });
});

/**
 * A host reports every volume it holds on every report, and measures them on a slower pass of
 * its own — so most reports carry no reading, and the ones that do are the only writes.
 */
describe('how full a filesystem is, as the host that holds it last measured it', () => {
  const MEASURED: FilesystemUsage = {
    totalBytes: 8_455_712_768,
    usedBytes: 1_503_238_553,
    measuredAt: Value.Parse(TimestampSchema, '2026-08-03T10:00:00Z'),
  };

  function reportedVolume(usage?: FilesystemUsage): ReportedVolume {
    return {
      volumeId: VOLUME_ID,
      appId: APP_ID,
      state: 'ready',
      sizeBytes: NO_BYTES,
      ...(usage ? { usage } : {}),
    };
  }

  test('a reading a host took is recorded against the app that owns the volume', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });

    await serviceWith({ appsRepo }).recordVolumeUsage({ volumes: [reportedVolume(MEASURED)] });

    expect(appsRepo.measured).toEqual([new Map([[APP_ID, MEASURED]])]);
  });

  // Otherwise every report between two measurements would look like a filesystem emptying and
  // filling again, which is the one thing this must never be able to say.
  test('a report carrying no reading writes nothing rather than writing nothing down', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });

    await serviceWith({ appsRepo }).recordVolumeUsage({ volumes: [reportedVolume()] });

    expect(appsRepo.measured).toEqual([]);
  });

  // `ON CONFLICT DO UPDATE` refuses to touch one row twice in a statement, so a host that
  // reported two volumes for one app would otherwise take its whole report down with it.
  test('two volumes naming one app are written once, as the later reading', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    const earlier = {
      ...MEASURED,
      measuredAt: Value.Parse(TimestampSchema, '2026-08-03T09:00:00Z'),
    };

    await serviceWith({ appsRepo }).recordVolumeUsage({
      volumes: [reportedVolume(earlier), reportedVolume(MEASURED)],
    });

    expect(appsRepo.measured).toEqual([new Map([[APP_ID, MEASURED]])]);
  });
});

/**
 * The compute half, which comes off the instances rather than the volumes — and is held to the
 * same three rules, because it arrives on the same report through the same seam.
 */
describe('what a guest is spending, as the host running it last measured it', () => {
  const SPENDING: ComputeUsage = {
    memoryTotalBytes: 1_031_012_352,
    memoryUsedBytes: 412_401_664,
    cpuShare: 0.18,
    measuredAt: Value.Parse(TimestampSchema, '2026-08-03T10:00:00Z'),
  };

  function reportedInstance(compute?: ComputeUsage): ReportedInstance {
    return {
      appId: APP_ID,
      deploymentId: DEPLOYMENT_ID,
      state: 'running',
      restartCount: 0,
      ...(compute ? { compute } : {}),
    };
  }

  /** An app asleep between requests, which is a host reporting no reading and saying why. */
  const ASLEEP: ReportedInstance = {
    appId: APP_ID,
    deploymentId: DEPLOYMENT_ID,
    state: 'idle',
    restartCount: 0,
  };

  test('a reading a host took is recorded against the app it is running', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });

    await serviceWith({ appsRepo }).recordComputeUsage({ instances: [reportedInstance(SPENDING)] });

    expect(appsRepo.spending).toEqual([new Map([[APP_ID, SPENDING]])]);
  });

  // Every report between two measurements carries instances and no readings, and a write on each
  // of those would be an app that stops spending anything a second after it was measured.
  test('a report carrying no reading writes nothing', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });

    await serviceWith({ appsRepo }).recordComputeUsage({ instances: [reportedInstance()] });

    expect(appsRepo.spending).toEqual([]);
  });

  /**
   * The difference between a reading that did not arrive and a guest that is not there. Leaving
   * the last figure standing would have an app holding nothing go on being shown spending what it
   * spent before it slept, for as long as it slept.
   */
  test('an app reported asleep is forgotten rather than left as it was', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });

    await serviceWith({ appsRepo }).recordComputeUsage({ instances: [ASLEEP] });

    expect(appsRepo.forgotten).toEqual([[APP_ID]]);
    expect(appsRepo.spending).toEqual([]);
  });

  test('and a running app that simply was not measured is left exactly as it was', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });

    await serviceWith({ appsRepo }).recordComputeUsage({ instances: [reportedInstance()] });

    expect(appsRepo.forgotten).toEqual([]);
  });

  test('two instances naming one app are written once, as the later reading', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    const earlier = {
      ...SPENDING,
      measuredAt: Value.Parse(TimestampSchema, '2026-08-03T09:00:00Z'),
    };

    await serviceWith({ appsRepo }).recordComputeUsage({
      instances: [reportedInstance(earlier), reportedInstance(SPENDING)],
    });

    expect(appsRepo.spending).toEqual([new Map([[APP_ID, SPENDING]])]);
  });
});

describe('an app keeps its hostnames until it is deleted rather than deleting', () => {
  function appHostnames(): DisposableAppHostnameRow[] {
    return [
      {
        hostname: Value.Parse(HostnameSchema, `${APP_NAME}.${APP_HOST_DOMAIN}`),
        kind: 'platform',
        cloudflare_id: null,
      },
      { hostname: BROUGHT_HOSTNAME, kind: 'custom', cloudflare_id: CLOUDFLARE_ID },
    ];
  }

  // An app with a filesystem to tear down stays `deleting`, which is a state its owner is still
  // shown it in — and shown with the hostname it holds. Releasing the rows here left the listing
  // describing an app that had none, which failed the whole listing rather than that one app.
  test('deletion returns with the rows still there, because the app is still one to show', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    const hostnamesRepo = new StubHostnameAccess();
    const edge = new StubCustomHostnameRemoval();
    appsRepo.owns = true;
    appsRepo.deployedApps.push(APP_ID);
    hostnamesRepo.disposable.set(APP_ID, appHostnames());

    const app = await serviceWith({ appsRepo, hostnamesRepo, customHostnamesRepo: edge }).delete({
      appId: APP_ID,
      ownerId: OWNER_ID,
    });

    expect(app.state).toBe('deleting');
    expect(hostnamesRepo.removed).toEqual([]);
    expect(hostnamesRepo.disposable.get(APP_ID)).toEqual(appHostnames());
    expect(edge.removed).toEqual([]);
  });

  test('the platform name and a custom domain are both free once the app is purged', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    const hostnamesRepo = new StubHostnameAccess();
    const edge = new StubCustomHostnameRemoval();
    appsRepo.owns = true;
    hostnamesRepo.disposable.set(APP_ID, appHostnames());
    const apps = serviceWith({ appsRepo, hostnamesRepo, customHostnamesRepo: edge });

    await apps.delete({ appId: APP_ID, ownerId: OWNER_ID });
    appsRepo.purgeable.push(APP_ID);
    await apps.purgeDeleted();

    expect(hostnamesRepo.removed).toEqual([
      Value.Parse(HostnameSchema, `${APP_NAME}.${APP_HOST_DOMAIN}`),
      BROUGHT_HOSTNAME,
    ]);
    expect(edge.removed).toEqual([CLOUDFLARE_ID]);
  });

  test('an edge failure keeps its row for the next sweep to retry', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    const hostnamesRepo = new StubHostnameAccess();
    const edge = new StubCustomHostnameRemoval();
    appsRepo.owns = true;
    hostnamesRepo.disposable.set(APP_ID, appHostnames());
    edge.failures.add(CLOUDFLARE_ID);
    const apps = serviceWith({ appsRepo, hostnamesRepo, customHostnamesRepo: edge });

    await apps.delete({ appId: APP_ID, ownerId: OWNER_ID });
    appsRepo.purgeable.push(APP_ID);
    await apps.purgeDeleted();

    expect(hostnamesRepo.disposable.get(APP_ID)).toEqual([
      { hostname: BROUGHT_HOSTNAME, kind: 'custom', cloudflare_id: CLOUDFLARE_ID },
    ]);

    edge.failures.delete(CLOUDFLARE_ID);
    appsRepo.purgeable.push(APP_ID);
    await apps.purgeDeleted();

    expect(hostnamesRepo.disposable.get(APP_ID)).toEqual([]);
    expect(edge.removed).toEqual([CLOUDFLARE_ID]);
  });
});

const SECOND_APP_ID = Value.Parse(AppIdSchema, '01927e3a-0000-7000-8000-00000000beef');

const SOLO_BINARY = objectKey('solo-binary-digest');
const BUNDLE = objectKey('exports/app/bundle.tar.gz');

function purgeableApp({
  appsRepo,
  appId,
  leftovers,
}: {
  appsRepo: StubAppsRepository;
  appId: AppId;
  leftovers: Leftovers;
}): void {
  appsRepo.purgeable.push(appId);
  appsRepo.leftovers.set(appId, leftovers);
}

describe('what a deleted app leaves behind is removed after it', () => {
  test('the binaries and the bundles both go', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    const artifacts = new StubObjectStorage({ trace: appsRepo.trace });
    const exports = new StubObjectStorage({ trace: appsRepo.trace });
    purgeableApp({
      appsRepo,
      appId: APP_ID,
      leftovers: { artifacts: [SOLO_BINARY], exports: [BUNDLE] },
    });

    await serviceWith({
      appsRepo,
      artifactStorageRepo: artifacts,
      exportStorageRepo: exports,
    }).purgeDeleted();

    expect(artifacts.removed).toEqual([SOLO_BINARY]);
    expect(exports.removed).toEqual([BUNDLE]);
  });

  // A row deleted before its object is bytes nothing names; an object deleted before its row is
  // work the next pass reads again. Only one of those two orders is recoverable.
  test('every object goes before the rows naming it', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    const artifacts = new StubObjectStorage({ trace: appsRepo.trace });
    const exports = new StubObjectStorage({ trace: appsRepo.trace });
    purgeableApp({
      appsRepo,
      appId: APP_ID,
      leftovers: { artifacts: [SOLO_BINARY], exports: [BUNDLE] },
    });

    await serviceWith({
      appsRepo,
      artifactStorageRepo: artifacts,
      exportStorageRepo: exports,
    }).purgeDeleted();

    expect(appsRepo.trace.at(-1)).toBe(`rows:${APP_ID}`);
    expect(appsRepo.trace).toContain(`object:${SOLO_BINARY}`);
  });

  test('an app with nothing left is not asked about again', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    purgeableApp({ appsRepo, appId: APP_ID, leftovers: { artifacts: [], exports: [] } });
    const apps = serviceWith({ appsRepo });

    await apps.purgeDeleted();
    await apps.purgeDeleted();

    expect(appsRepo.trace).toEqual([`rows:${APP_ID}`]);
  });

  test('nothing to purge does nothing', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });

    await serviceWith({ appsRepo }).purgeDeleted();

    expect(appsRepo.trace).toEqual([]);
  });
});

describe('a purge that cannot finish leaves the work to be found again', () => {
  test('a bucket refusing one object keeps the rows that name it', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    const artifacts = new StubObjectStorage({
      trace: appsRepo.trace,
      refuse: new Set([SOLO_BINARY]),
    });
    purgeableApp({
      appsRepo,
      appId: APP_ID,
      leftovers: { artifacts: [SOLO_BINARY], exports: [] },
    });

    await serviceWith({ appsRepo, artifactStorageRepo: artifacts }).purgeDeleted();

    expect(appsRepo.trace).toEqual([]);
    expect(appsRepo.purgeable).toEqual([APP_ID]);
  });

  // This runs on the way through a host report, so one bucket failure must not cost the report
  // or the apps queued behind the app it failed on.
  test('the app after the one that failed is still purged', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    const artifacts = new StubObjectStorage({
      trace: appsRepo.trace,
      refuse: new Set([SOLO_BINARY]),
    });
    purgeableApp({
      appsRepo,
      appId: APP_ID,
      leftovers: { artifacts: [SOLO_BINARY], exports: [] },
    });
    purgeableApp({
      appsRepo,
      appId: SECOND_APP_ID,
      leftovers: { artifacts: [], exports: [BUNDLE] },
    });

    await serviceWith({ appsRepo, artifactStorageRepo: artifacts }).purgeDeleted();

    expect(appsRepo.trace).toContain(`rows:${SECOND_APP_ID}`);
    expect(appsRepo.purgeable).toEqual([APP_ID]);
  });
});

describe('an app with no filesystem to tear down is not left waiting for one', () => {
  // Reaching `deleted` takes a host saying the filesystem is gone, and no host is ever told
  // about an app that was never deployed. Waiting for that is waiting forever.
  test('an app deployed no times is deleted as it is asked for', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    appsRepo.owns = true;

    const app = await serviceWith({ appsRepo }).delete({ appId: APP_ID, ownerId: OWNER_ID });

    expect(app.state).toBe('deleted');
    expect(appsRepo.deleted).toEqual([APP_ID]);
  });

  // The volume is the thing that has to be let go of, so an app that has one waits for the host
  // holding it however the deletion was asked for.
  test('an app that has been deployed still waits for the host holding it', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    appsRepo.owns = true;
    appsRepo.deployedApps = [APP_ID];

    const app = await serviceWith({ appsRepo }).delete({ appId: APP_ID, ownerId: OWNER_ID });

    expect(app.state).toBe('deleting');
    expect(appsRepo.deleted).toEqual([]);
  });

  // Deleting is what ends an export, and it ends one whether or not there is a filesystem left
  // for the host to have been reading.
  test('an export still being written is ended either way', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    appsRepo.owns = true;
    const exportsRepo = new StubExportCancellation();

    await serviceWith({ appsRepo, exportsRepo }).delete({ appId: APP_ID, ownerId: OWNER_ID });

    expect(exportsRepo.cancelled).toEqual([APP_ID]);
  });
});

describe('a deletion left stuck before any of this existed is finished when one is found', () => {
  // These predate a deletion being able to finish itself, so nothing wrote down that they were
  // owed: they are found by the state they are still in.
  test('an app stuck deleting with no filesystem is finished by a host report', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    appsRepo.deleting = [APP_ID];

    await serviceWith({ appsRepo }).finishDeletions();

    expect(appsRepo.deleted).toEqual([APP_ID]);
  });

  test('an app still waiting on the host holding its volume is left alone', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    appsRepo.deleting = [APP_ID];
    appsRepo.deployedApps = [APP_ID];

    await serviceWith({ appsRepo }).finishDeletions();

    expect(appsRepo.deleted).toEqual([]);
  });

  test('an app nobody asked to delete is not deleted by the sweep', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });

    await serviceWith({ appsRepo }).finishDeletions();

    expect(appsRepo.deleted).toEqual([]);
  });
});
