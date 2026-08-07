import { describe, expect, test } from 'bun:test';
import {
  type AppId,
  AppIdSchema,
  type AppState,
  type DnsLabel,
  DnsLabelSchema,
  type Hostname,
  HostnameSchema,
  type ObjectKey,
  ObjectKeySchema,
  type OwnerId,
  type ReportedVolume,
  Value,
  VolumeIdSchema,
} from '@repo/protocol';
import { SQL } from 'bun';
import type { AppConfigPatch, PublicAppConfig } from '#lib/app-config.ts';
import { ConflictError, NotFoundError } from '#lib/errors.ts';
import type {
  AppHostnameRow,
  AppRow,
  AppsRepositoryContract,
  CreatedApp,
  Leftovers,
  OwnedAppHostnameRow,
} from '#repositories/apps.repository.ts';
import type { ArtifactStorageRepositoryContract } from '#repositories/artifact-storage.repository.ts';
import type { ExportStorageRepositoryContract } from '#repositories/export-storage.repository.ts';
import { AppsService, type ExportCancellation } from '#services/apps.service.ts';
import {
  APP_HOST_DOMAIN,
  APP_ID,
  configColumns,
  DEFAULT_CONFIG,
  OWNER_ID,
} from '#tests/services/support/fixtures.ts';
import { uniqueViolation } from '#tests/support/postgres.ts';

const APP_NAME = 'pocketbase';

// Restated rather than imported from the implementation: that the bound exists and how many
// rolls it allows is the contract this file holds the service to.
const MAX_SLUG_ATTEMPTS = 5;

const COLLISIONS_BEFORE_SUCCESS = 2;

function distinct(slugs: readonly DnsLabel[]): number {
  return new Set(slugs).size;
}

function appRow(slug: DnsLabel): AppRow {
  return {
    id: APP_ID,
    owner_id: OWNER_ID,
    slug,
    state: 'active',
    created_at: new Date(),
    updated_at: new Date(),
    ...configColumns(DEFAULT_CONFIG),
  };
}

/**
 * Records every slug it is offered and rejects the first `failures` of them, so a test can ask
 * what the service did rather than how it did it. Every read answers empty, which is what an
 * app belonging to somebody else looks like.
 */
class StubAppsRepository implements AppsRepositoryContract {
  readonly offeredSlugs: DnsLabel[] = [];
  readonly offeredConfigs: PublicAppConfig[] = [];
  readonly deleted: AppId[] = [];
  readonly trace: string[] = [];
  readonly leftovers = new Map<AppId, Leftovers>();
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

  // An app is deployed at least once or it is not, and only the first has a volume anyone holds.
  hasDesiredVolume({ appId }: { appId: AppId }): Promise<boolean> {
    return Promise.resolve(this.deployedApps.includes(appId));
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
    config: PublicAppConfig;
  }): Promise<CreatedApp> {
    this.offeredSlugs.push(slug);
    this.offeredConfigs.push(config);
    if (this.#remainingFailures > 0) {
      this.#remainingFailures--;
      return Promise.reject(this.#failure);
    }
    return Promise.resolve({
      app: appRow(slug),
      hostnames: [{ hostname, kind: 'platform' }],
    });
  }

  isOwnedBy(): Promise<boolean> {
    return Promise.resolve(false);
  }

  listByOwner(): Promise<AppRow[]> {
    return Promise.resolve([]);
  }

  listHostnamesByOwner(): Promise<OwnedAppHostnameRow[]> {
    return Promise.resolve([]);
  }

  findById(): Promise<AppRow | null> {
    return Promise.resolve(null);
  }

  listHostnamesByApp(): Promise<AppHostnameRow[]> {
    return Promise.resolve([]);
  }

  updateConfig(_: {
    appId: AppId;
    ownerId: OwnerId;
    patch: AppConfigPatch;
  }): Promise<AppRow | null> {
    return Promise.resolve(null);
  }

  updateState({
    appId,
    state,
  }: {
    appId: AppId;
    ownerId: OwnerId;
    state: AppState;
  }): Promise<AppRow | null> {
    if (!this.owns) {
      return Promise.resolve(null);
    }
    // The state the app is left in is what `finishDeleting` then has to find, so it is recorded
    // rather than only returned.
    if (state === 'deleting') {
      this.deleting.push(appId);
    }
    return Promise.resolve({ ...appRow(Value.Parse(DnsLabelSchema, APP_NAME)), state });
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

class StubArtifactStorage extends StubObjectStorage implements ArtifactStorageRepositoryContract {
  put(): Promise<void> {
    return Promise.resolve();
  }

  exists(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

class StubExportStorage extends StubObjectStorage implements ExportStorageRepositoryContract {
  signDownload(): string {
    return '';
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
  exportsRepo = new StubExportCancellation(),
  artifactStorageRepo = new StubArtifactStorage({ trace: [] }),
  exportStorageRepo = new StubExportStorage({ trace: [] }),
}: {
  appsRepo: AppsRepositoryContract;
  exportsRepo?: ExportCancellation;
  artifactStorageRepo?: ArtifactStorageRepositoryContract;
  exportStorageRepo?: ExportStorageRepositoryContract;
}) {
  return new AppsService({
    appsRepo,
    exportsRepo,
    artifactStorageRepo,
    exportStorageRepo,
    appHostDomain: APP_HOST_DOMAIN,
  });
}

function createApp({
  appsRepo,
  config,
}: {
  appsRepo: AppsRepositoryContract;
  config?: AppConfigPatch;
}) {
  return serviceWith({ appsRepo }).create({ ownerId: OWNER_ID, name: APP_NAME, config });
}

describe('a taken hostname is a re-roll, not something the owner sees', () => {
  test('a collision produces a second attempt carrying fresh entropy', async () => {
    const appsRepo = new StubAppsRepository({
      failures: 1,
      failure: uniqueViolation('apps_slug_key'),
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
      failure: uniqueViolation('app_hostnames_hostname_key'),
    });

    const app = await createApp({ appsRepo });

    expect(appsRepo.offeredSlugs).toHaveLength(COLLISIONS_BEFORE_SUCCESS + 1);
    expect(distinct(appsRepo.offeredSlugs)).toBe(appsRepo.offeredSlugs.length);
    expect(app.hostnames).toEqual([
      { hostname: Value.Parse(HostnameSchema, `${app.slug}.${APP_HOST_DOMAIN}`), kind: 'platform' },
    ]);
  });
});

describe('retrying is bounded, and only covers collisions', () => {
  test('an unbroken run of collisions is surfaced instead of retried forever', async () => {
    const appsRepo = new StubAppsRepository({
      failures: Number.POSITIVE_INFINITY,
      failure: uniqueViolation('apps_slug_key'),
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

// Secrets storage is deferred, so `environment` is not a column and nothing the api writes
// carries one. What a later secrets layer adds is a table, not a key in here.
describe('an app is created with no environment and never reports one', () => {
  test('a partial config is completed from the protocol defaults', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });

    await createApp({ appsRepo, config: { args: ['serve'] } });

    expect(appsRepo.offeredConfigs).toEqual([{ ...DEFAULT_CONFIG, args: ['serve'] }]);
  });

  test('the config the api persists has no environment to store', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });

    await createApp({ appsRepo });

    expect(Object.keys(appsRepo.offeredConfigs[0] ?? {})).not.toContain('environment');
  });

  test('an unconfigured app falls back to the defaults the protocol publishes', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });

    await createApp({ appsRepo });

    expect(appsRepo.offeredConfigs).toEqual([DEFAULT_CONFIG]);
  });

  test('the config on the wire has no environment to leak', async () => {
    const app = await createApp({ appsRepo: new StubAppsRepository({ failures: 0 }) });

    expect(Object.keys(app.config)).not.toContain('environment');
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
    const artifacts = new StubArtifactStorage({ trace: appsRepo.trace });
    const exports = new StubExportStorage({ trace: appsRepo.trace });
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
    const artifacts = new StubArtifactStorage({ trace: appsRepo.trace });
    const exports = new StubExportStorage({ trace: appsRepo.trace });
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
    const artifacts = new StubArtifactStorage({
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
    const artifacts = new StubArtifactStorage({
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
