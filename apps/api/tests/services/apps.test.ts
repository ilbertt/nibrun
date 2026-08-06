import { describe, expect, test } from 'bun:test';
import type {
  AppId,
  AppState,
  DnsLabel,
  Hostname,
  OwnerId,
  ReportedVolume,
  VolumeId,
} from '@repo/protocol';
import { SQL } from 'bun';
import type { AppConfigPatch, PublicAppConfig } from '#lib/app-config.ts';
import { ConflictError, NotFoundError } from '#lib/errors.ts';
import type {
  AppHostnameRow,
  AppRow,
  AppsRepositoryContract,
  CreatedApp,
  OwnedAppHostnameRow,
} from '#repositories/apps.repository.ts';
import { AppsService } from '#services/apps.service.ts';
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
  deleting: AppId[] = [];
  owns = false;
  #remainingFailures: number;
  readonly #failure: unknown;

  constructor({ failures, failure }: { failures: number; failure?: unknown }) {
    this.#remainingFailures = failures;
    this.#failure = failure;
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
    state,
  }: {
    appId: AppId;
    ownerId: OwnerId;
    state: AppState;
  }): Promise<AppRow | null> {
    return Promise.resolve(this.owns ? { ...appRow(APP_NAME as DnsLabel), state } : null);
  }
}

const VOLUME_ID = APP_ID as string as VolumeId;
const NO_BYTES = 0;

function serviceWith(appsRepo: AppsRepositoryContract) {
  return new AppsService({ appsRepo, appHostDomain: APP_HOST_DOMAIN });
}

function createApp({
  appsRepo,
  config,
}: {
  appsRepo: AppsRepositoryContract;
  config?: AppConfigPatch;
}) {
  return serviceWith(appsRepo).create({ ownerId: OWNER_ID, name: APP_NAME, config });
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
    expect(app.slug).toBe(appsRepo.offeredSlugs[1] as DnsLabel);
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
      { hostname: `${app.slug}.${APP_HOST_DOMAIN}` as Hostname, kind: 'platform' },
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
    const service = serviceWith(new StubAppsRepository({ failures: 0 }));
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

  test('asking leaves the app deleting rather than deleted', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    appsRepo.owns = true;

    const app = await serviceWith(appsRepo).delete({ appId: APP_ID, ownerId: OWNER_ID });

    expect(app.state).toBe('deleting');
    expect(appsRepo.deleted).toEqual([]);
  });

  test('a host saying the filesystem is gone is what finishes it', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    appsRepo.deleting = [APP_ID];

    await serviceWith(appsRepo).completeDeletions({ volumes: [reportedVolume('deleted')] });

    expect(appsRepo.deleted).toEqual([APP_ID]);
  });

  // A volume the host still holds is one whose app is not deleted, however long it has been
  // asked for — `deleting` on the app is a request, not an outcome.
  const held: ReportedVolume['state'][] = ['ready', 'detached', 'pending', 'failed'];
  for (const state of held) {
    test(`a volume the host reports as ${state} leaves the app where it is`, async () => {
      const appsRepo = new StubAppsRepository({ failures: 0 });
      appsRepo.deleting = [APP_ID];

      await serviceWith(appsRepo).completeDeletions({ volumes: [reportedVolume(state)] });

      expect(appsRepo.deleted).toEqual([]);
    });
  }

  // The host keeps reporting the volume until desired state stops naming it, so this arrives
  // many times for one deletion.
  test('the same report arriving again deletes nothing a second time', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });
    appsRepo.deleting = [APP_ID];
    const apps = serviceWith(appsRepo);

    await apps.completeDeletions({ volumes: [reportedVolume('deleted')] });
    await apps.completeDeletions({ volumes: [reportedVolume('deleted')] });

    expect(appsRepo.deleted).toEqual([APP_ID]);
  });

  // Nothing asked for this one to go, so a host that lost a filesystem must not be able to
  // delete the app that owns it.
  test('an app nobody asked to delete survives its volume going missing', async () => {
    const appsRepo = new StubAppsRepository({ failures: 0 });

    await serviceWith(appsRepo).completeDeletions({ volumes: [reportedVolume('deleted')] });

    expect(appsRepo.deleted).toEqual([]);
  });
});
