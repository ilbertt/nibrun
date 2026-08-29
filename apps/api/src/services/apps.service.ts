import {
  type App,
  type AppId,
  type ComputeUsage,
  EXTRA_PUBLIC_PORT_VALUES,
  type FilesystemUsage,
  interpolableRuntimeValue,
  namesExtraPublicPortValues,
  OWNED_APP_STATES,
  type OwnedAppState,
  type OwnerId,
  REDACTED,
  type ReportedInstance,
  type ReportedVolume,
  type TenantEnvironment,
} from '@repo/protocol';
import { schema } from '#db/queries.gen.ts';
import {
  type AppConfigPatch,
  configWithDefaults,
  type NewAppConfig,
  type PublicAppConfig,
  type SealedConfigPatch,
  splitEnvironmentPatch,
  toAppConfig,
} from '#lib/app-config.ts';
import { type PublicAppHostname, platformHostname, toAppHostname } from '#lib/app-hostname.ts';
import { deriveAppSlug } from '#lib/app-slug.ts';
import { BadRequestError, ConflictError, NotFoundError } from '#lib/errors.ts';
import { isUniqueViolation } from '#lib/pg-errors.ts';
import { sealEnvironment, type TenantSecretsKey } from '#lib/tenant-secrets.ts';
import { toTimestamp } from '#lib/timestamp.ts';
import type {
  AppHostnameRow,
  AppHostnamesRepositoryContract,
} from '#repositories/app-hostnames.repository.ts';
import {
  type AppRow,
  type AppsRepositoryContract,
  LIVE_APP_STATES,
} from '#repositories/apps.repository.ts';
import type { ArtifactStorageRepositoryContract } from '#repositories/artifact-storage.repository.ts';
import type { CustomHostnamesRepositoryContract } from '#repositories/custom-hostnames.repository.ts';
import type { ExportsRepositoryContract } from '#repositories/exports.repository.ts';
import { Service } from '#services/service.ts';

export type PublicApp = Omit<App, 'config' | 'hostnames'> & {
  config: PublicAppConfig;
  hostnames: PublicAppHostname[];
  /** `null` until a host has measured the filesystem, which it cannot while nothing mounts it. */
  volumeUsage: FilesystemUsage | null;
  computeUsage: ComputeUsage | null;
};

type AppWithHostnames = { app: AppRow; hostnames: readonly AppHostnameRow[] };

type OwnedApp = { appId: AppId; ownerId: OwnerId };

// Both are unique platform-wide and both are minted from the same label, so either one coming
// back as taken means the same thing: this roll of the dice is spent.
const SLUG_CONSTRAINTS = [
  schema.apps._indexes.apps_slug_key._indexName,
  schema.app_hostnames._indexes.app_hostnames_hostname_key._indexName,
];

// Six characters of base32 make a collision vanishingly rare, so exhausting this many rolls is
// a signal that something other than luck is wrong.
const MAX_SLUG_ATTEMPTS = 5;

/** What an app needs from its hostnames while it lives and while it is being removed. */
export type AppHostnameAccess = Pick<
  AppHostnamesRepositoryContract,
  'listByOwner' | 'listByApp' | 'listDisposable' | 'removeDisposable'
>;

export type CustomHostnameRemoval = Pick<CustomHostnamesRepositoryContract, 'remove'>;

/** What deleting an app needs from the exports it leaves behind, and nothing else. */
export type ExportCancellation = Pick<ExportsRepositoryContract, 'failInFlight'>;

/**
 * Likewise for the buckets: purging only ever takes objects out of them. Narrowed so that a
 * service holding the whole of one — able to sign an upload, or read a tenant's binary back —
 * is not what a reader has to rule out here.
 */
export type ObjectRemoval = Pick<ArtifactStorageRepositoryContract, 'remove'>;

const APP_DELETED = 'The app was deleted while this export was still being written.';

/**
 * How many deleted apps one host report cleans up after. Small, because it is work done on the
 * way through a request that a host is waiting on, and a backlog only ever grows by one app per
 * deletion — the next report takes the next batch.
 */
const PURGE_BATCH = 8;

/**
 * How many stuck deletions one host report finishes. Only apps from before a deletion could
 * finish itself ever land here, so this drains a backlog that never grows.
 */
const FINISH_BATCH = 8;

export class AppsService extends Service {
  private readonly appsRepo: AppsRepositoryContract;
  private readonly hostnamesRepo: AppHostnameAccess;
  private readonly customHostnamesRepo: CustomHostnameRemoval;
  private readonly exportsRepo: ExportCancellation;
  private readonly artifactStorageRepo: ObjectRemoval;
  private readonly exportStorageRepo: ObjectRemoval;
  private readonly appHostDomain: string;
  private readonly secretsKey: TenantSecretsKey;

  constructor({
    appsRepo,
    hostnamesRepo,
    customHostnamesRepo,
    exportsRepo,
    artifactStorageRepo,
    exportStorageRepo,
    appHostDomain,
    secretsKey,
  }: {
    appsRepo: AppsRepositoryContract;
    hostnamesRepo: AppHostnameAccess;
    customHostnamesRepo: CustomHostnameRemoval;
    exportsRepo: ExportCancellation;
    artifactStorageRepo: ObjectRemoval;
    exportStorageRepo: ObjectRemoval;
    appHostDomain: string;
    secretsKey: TenantSecretsKey;
  }) {
    super();
    this.appsRepo = appsRepo;
    this.hostnamesRepo = hostnamesRepo;
    this.customHostnamesRepo = customHostnamesRepo;
    this.exportsRepo = exportsRepo;
    this.artifactStorageRepo = artifactStorageRepo;
    this.exportStorageRepo = exportStorageRepo;
    this.appHostDomain = appHostDomain;
    this.secretsKey = secretsKey;
  }

  /**
   * A taken hostname is a re-roll, never an error the owner sees: they picked a name, not a
   * URL, and two owners are entitled to pick the same name.
   */
  async create({
    ownerId,
    name,
    config,
  }: {
    ownerId: OwnerId;
    name: string;
    config?: NewAppConfig;
  }): Promise<PublicApp> {
    const environment = config?.environment ?? {};
    refuseRedactedValues(environment);
    const withDefaults = configWithDefaults(config);
    refuseValuesNeedingAPort({
      environment,
      hasExtraPublicPort: withDefaults.hasExtraPublicPort,
    });
    const appConfig = {
      ...withDefaults,
      environment: sealEnvironment({ key: this.secretsKey, environment }),
    };

    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      const slug = deriveAppSlug(name);
      try {
        const created = await this.appsRepo.create({
          ownerId,
          slug,
          hostname: platformHostname({ slug, appHostDomain: this.appHostDomain }),
          config: appConfig,
        });
        return toPublicApp(created);
      } catch (error) {
        if (!SLUG_CONSTRAINTS.some((constraint) => isUniqueViolation({ error, constraint }))) {
          throw error;
        }
        this.logger.warn('app hostname already taken, re-rolling', { slug });
      }
    }

    throw new ConflictError('Could not mint a free hostname for the app.');
  }

  /**
   * The same rule as on create, against the config the edit leaves behind rather than the one it
   * carries: a value naming these is allowed by an app that already has the port, and refused by
   * one whose port this very edit is taking away.
   *
   * Only ever a read when a value names one, which is almost never — so a patch that says nothing
   * about them is the one write it was.
   *
   * The other direction is not guarded: an app that gives up its port while a variable it is not
   * restating still names one fails its next boot, loudly, having asked for exactly that. What is
   * worth an answer here is the value someone is typing now.
   */
  private async refuseValuesTheEditLeavesUngiven({
    appId,
    ownerId,
    patch,
  }: OwnedApp & { patch: AppConfigPatch }): Promise<void> {
    const naming = Object.entries(patch.environment ?? {}).filter(
      ([, value]) => value !== null && namesExtraPublicPortValues(value),
    );
    if (naming.length === 0) {
      return;
    }

    const hasExtraPublicPort =
      patch.hasExtraPublicPort ??
      requireApp(await this.appsRepo.findById({ appId, ownerId })).has_extra_public_port;

    refuseValuesNeedingAPort({
      environment: Object.fromEntries(naming) as TenantEnvironment,
      hasExtraPublicPort,
    });
  }

  private sealed({ environment, ...rest }: AppConfigPatch): SealedConfigPatch {
    if (environment === undefined) {
      return rest;
    }

    const { set, removed } = splitEnvironmentPatch(environment);
    refuseRedactedValues(set);

    return {
      ...rest,
      environment: { set: sealEnvironment({ key: this.secretsKey, environment: set }), removed },
    };
  }

  async list({ ownerId }: { ownerId: OwnerId }): Promise<PublicApp[]> {
    const [apps, hostnames] = await Promise.all([
      this.appsRepo.listByOwner({ ownerId }),
      this.hostnamesRepo.listByOwner({ ownerId }),
    ]);
    const byApp = Map.groupBy(hostnames, (row) => row.app_id);

    return apps.map((app) => toPublicApp({ app, hostnames: byApp.get(app.id) ?? [] }));
  }

  async get({ appId, ownerId }: OwnedApp): Promise<PublicApp> {
    const [app, hostnames] = await Promise.all([
      this.appsRepo.findById({ appId, ownerId }),
      this.hostnamesRepo.listByApp({ appId, ownerId }),
    ]);

    return toPublicApp({ app: requireApp(app), hostnames });
  }

  async updateConfig({
    appId,
    ownerId,
    patch,
  }: OwnedApp & { patch: AppConfigPatch }): Promise<PublicApp> {
    await this.refuseValuesTheEditLeavesUngiven({ appId, ownerId, patch });
    const app = requireApp(
      await this.appsRepo.updateConfig({ appId, ownerId, patch: this.sealed(patch) }),
    );
    const hostnames = await this.hostnamesRepo.listByApp({ appId, ownerId });

    return toPublicApp({ app, hostnames });
  }

  /**
   * Suspending an app takes the microVM down and leaves everything else standing: the volume and
   * every byte on it, the hostnames, the deployment that was current. Resuming boots that same
   * release again, so an app comes back as the thing that went away rather than as a new one.
   *
   * A host is not told to stop anything — the app being anything other than `active` is what its
   * desired instance state is read from, so this is one row and the next poll.
   *
   * An app being deleted is refused rather than moved: the teardown is already running, and
   * `deleting` is not a state there is a way back out of.
   */
  async setState({
    appId,
    ownerId,
    state,
  }: OwnedApp & { state: OwnedAppState }): Promise<PublicApp> {
    const app = await this.appsRepo.updateState({
      appId,
      ownerId,
      state,
      from: OWNED_APP_STATES,
    });
    if (!app) {
      // Owned and unmoved means the predicate refused it, which it only ever does for a deletion
      // already under way. Asked only when the update declined, so the usual path is one write.
      if (await this.appsRepo.isOwnedBy({ appId, ownerId })) {
        throw new ConflictError('The app is being deleted.');
      }
      throw new NotFoundError('App not found.');
    }
    const hostnames = await this.hostnamesRepo.listByApp({ appId, ownerId });
    // The row is the whole of what this does, and it is what a host reads to decide whether to
    // run the app — so an app that stopped serving has one line here saying who asked for it.
    this.logger.info('app state changed', { appId, state });

    return toPublicApp({ app, hostnames });
  }

  /**
   * What the hosts last measured of the filesystems they hold. Only the volumes carrying a
   * reading: a host reports every volume it has on every report, and most of those reports are
   * between measurements — so a missing reading means nothing new was taken, never that the
   * filesystem emptied.
   *
   * One statement for the whole report rather than one per volume, because this sits on the path
   * every host takes every few seconds: a host holding fifty apps would otherwise hold the report
   * open for fifty round trips before anything after it could run.
   *
   * Deduplicated because `ON CONFLICT DO UPDATE` refuses to touch a row twice in one statement,
   * and a host that reported two volumes for one app would take its whole report down with it.
   */
  async recordVolumeUsage({ volumes }: { volumes: readonly ReportedVolume[] }): Promise<void> {
    const readings = new Map<AppId, FilesystemUsage>();
    for (const volume of volumes) {
      if (volume.usage) {
        readings.set(volume.appId, volume.usage);
      }
    }
    if (readings.size > 0) {
      await this.appsRepo.recordVolumeUsage({ readings });
    }
  }

  /**
   * The compute half, taken off the instances rather than the volumes: what a guest is spending
   * belongs to the microVM running the app, and a volume outlives every microVM that mounts it.
   *
   * Deduplicated for the same reason, and by the same rule — an app has one instance on a host,
   * and a report naming it twice must not take the whole report down with it.
   */
  async recordComputeUsage({
    instances,
  }: {
    instances: readonly ReportedInstance[];
  }): Promise<void> {
    const readings = new Map<AppId, ComputeUsage>();
    for (const instance of instances) {
      if (instance.compute) {
        readings.set(instance.appId, instance.compute);
      }
    }
    if (readings.size > 0) {
      await this.appsRepo.recordComputeUsage({ readings });
    }
  }

  /**
   * The row stays behind: tearing an app down is the agent's work, the owner follows it through
   * this same state, and the slug must never be handed to a second app whatever happens.
   */
  /**
   * Deleting an app finishes on the host that held its data. Until a host says the filesystem is
   * gone the app stays `deleting`, because the alternative is calling it deleted while a tenant's
   * bytes are still on a disk somewhere.
   *
   * Read off the volumes rather than their absence: a report that lost some would otherwise
   * delete the apps it forgot to mention.
   */
  async completeDeletions({ volumes }: { volumes: readonly ReportedVolume[] }): Promise<void> {
    for (const volume of volumes) {
      if (volume.state !== 'deleted') {
        continue;
      }
      if (await this.appsRepo.finishDeleting({ appId: volume.appId })) {
        this.logger.info('app deleted', { appId: volume.appId, volumeId: volume.volumeId });
      }
    }
  }

  /**
   * Remove what a deleted app left behind: the binaries it was deployed from, the bundles it was
   * exported into, and the rows naming them. The filesystem went with the host; these did not,
   * and between them they are the tenant's code and every byte of their data.
   *
   * Driven off what is still there rather than off the moment an app became `deleted`, so a pass
   * that fails part way is retried by the next host report finding the same app still listed —
   * and so apps deleted before any of this existed are cleaned up by the first report after it.
   */
  async purgeDeleted(): Promise<void> {
    const appIds = await this.appsRepo.listPurgeable({ limit: PURGE_BATCH });
    for (const appId of appIds) {
      await this.purgeApp({ appId });
    }
  }

  /**
   * Objects first, rows last, because the rows are what makes the objects findable: a row deleted
   * before its object leaves bytes nothing names, while an object deleted before its row leaves a
   * row that the next pass reads again and acts on again. Both halves are safe to repeat.
   *
   * One app failing is logged rather than thrown: this runs on the way through a host report, and
   * a bucket refusing one delete is no reason to fail the report or to skip the apps after it.
   */
  private async purgeApp({ appId }: { appId: AppId }): Promise<void> {
    try {
      await this.releaseHostnames({ appId });
      const leftovers = await this.appsRepo.listLeftovers({ appId });
      await Promise.all([
        ...leftovers.exports.map((objectKey) => this.exportStorageRepo.remove({ objectKey })),
        ...leftovers.artifacts.map((objectKey) => this.artifactStorageRepo.remove({ objectKey })),
      ]);
      await this.appsRepo.purge({ appId });

      this.logger.info('deleted app purged', {
        appId,
        artifacts: leftovers.artifacts.length,
        exports: leftovers.exports.length,
      });
    } catch (error) {
      this.logger.error('purging a deleted app failed', { appId, error });
    }
  }

  /**
   * An export still running is ended here rather than left to finish, because there is nothing
   * left for it to finish into: the bundle would be reachable only through the app that is going,
   * and the host would spend minutes reading a filesystem the same reconcile pass tears down.
   *
   * After the state change, so it is only ever reached by an owner the app answered to — and
   * while the app is `deleting` rather than once it is `deleted`, which is the last generation of
   * desired state the host is told about it in.
   */
  async delete({ appId, ownerId }: OwnedApp): Promise<PublicApp> {
    const app = requireApp(
      await this.appsRepo.updateState({
        appId,
        ownerId,
        state: 'deleting',
        from: LIVE_APP_STATES,
      }),
    );
    await this.exportsRepo.failInFlight({ appId, message: APP_DELETED });
    const hostnames = await this.hostnamesRepo.listByApp({ appId, ownerId });
    const [torndown] = await Promise.all([
      this.finishIfNothingToTearDown({ appId }),
      this.releaseHostnames({ appId }),
    ]);

    return toPublicApp({ app: torndown ? { ...app, state: 'deleted' } : app, hostnames });
  }

  private async releaseHostnames({ appId }: { appId: AppId }): Promise<void> {
    const hostnames = await this.hostnamesRepo.listDisposable({ appId });
    for (const hostname of hostnames) {
      try {
        if (hostname.cloudflare_id) {
          await this.customHostnamesRepo.remove({ cloudflareId: hostname.cloudflare_id });
        }
        await this.hostnamesRepo.removeDisposable({ appId, hostname: hostname.hostname });
        this.logger.info('deleted app hostname released', {
          appId,
          hostname: hostname.hostname,
        });
      } catch (error) {
        this.logger.error('releasing a deleted app hostname failed', {
          appId,
          hostname: hostname.hostname,
          error,
        });
      }
    }
  }

  /**
   * `deleting` means waiting for a host to say the filesystem is gone, and an app that never had
   * a filesystem waits for a sentence nobody will ever speak. Answered here so the owner is told
   * what became of their app rather than told to wait for it.
   */
  private async finishIfNothingToTearDown({ appId }: { appId: AppId }): Promise<boolean> {
    if (!(await this.appsRepo.isDeletionFinishable({ appId }))) {
      return false;
    }
    return this.finishWithoutVolume({ appId });
  }

  /**
   * The same question asked of every app rather than of the one in hand, which is what reaches
   * the ones left `deleting` from before a deletion could finish itself. They are found by the
   * state they are in rather than remembered as owed, so this needs nothing written down and
   * nothing run by hand.
   *
   * Before `purgeDeleted` in a report, so an app finished here has what it left behind removed by
   * the same pass rather than by the next one.
   */
  async finishDeletions(): Promise<void> {
    const appIds = await this.appsRepo.listFinishableDeletions({ limit: FINISH_BATCH });
    for (const appId of appIds) {
      await this.finishWithoutVolume({ appId });
    }
  }

  private async finishWithoutVolume({ appId }: { appId: AppId }): Promise<boolean> {
    const finished = await this.appsRepo.finishDeleting({ appId });
    if (finished) {
      this.logger.info('app deleted without a filesystem to tear down', { appId });
    }
    return finished;
  }
}

/**
 * `[redacted]` is what every read returns in place of a value, so a caller sending it as one is a
 * caller echoing what it read. Stored, it would overwrite the secret with the word — and the app
 * would go on running, on the wrong value, with nothing said.
 */
function refuseRedactedValues(environment: TenantEnvironment): void {
  const echoed = Object.entries(environment)
    .filter(([, value]) => value === REDACTED)
    .map(([name]) => name);
  if (echoed.length > 0) {
    throw new BadRequestError(
      `${REDACTED} is what a read returns in place of a value, so it cannot be set as one: ${echoed.join(', ')}.`,
    );
  }
}

/**
 * The guest is given these two only when the app asked for a public port besides HTTP, and refuses
 * a reference it was not given rather than expanding it to nothing — so a value naming one on an
 * app without the port is a deploy that boots into an error nobody is watching for. Answered here
 * instead, while whoever typed it is still listening.
 *
 * The variable is named and its value never is: it is the tenant's secret either way.
 */
function refuseValuesNeedingAPort({
  environment,
  hasExtraPublicPort,
}: {
  environment: TenantEnvironment;
  hasExtraPublicPort: boolean;
}): void {
  if (hasExtraPublicPort) {
    return;
  }
  const naming = Object.entries(environment)
    .filter(([, value]) => namesExtraPublicPortValues(value))
    .map(([name]) => name);
  if (naming.length > 0) {
    throw new BadRequestError(
      `${EXTRA_PUBLIC_PORT_VALUES.map((value) => interpolableRuntimeValue(value.name)).join(' and ')} are only set for an app with a public port besides HTTP, which this one has not asked for: ${naming.join(', ')}.`,
    );
  }
}

// An app the caller does not own is indistinguishable from one that does not exist; a 403 would
// confirm it to a stranger.
function requireApp(app: AppRow | null): AppRow {
  if (!app) {
    throw new NotFoundError('App not found.');
  }
  return app;
}

/** Three columns of one LEFT JOIN, so either the reading is there or the app has never had one. */
function toVolumeUsage(app: AppRow): FilesystemUsage | null {
  if (
    app.volume_total_bytes === null ||
    app.volume_used_bytes === null ||
    app.volume_measured_at === null
  ) {
    return null;
  }
  return {
    totalBytes: Number(app.volume_total_bytes),
    usedBytes: Number(app.volume_used_bytes),
    measuredAt: toTimestamp(app.volume_measured_at),
  };
}

/**
 * The same, for the compute family — which keeps its own moment, so an app measured by a guest
 * that answered only one of the two verbs has one reading and not the other.
 *
 * `cpu_share` is the exception inside the exception: a share is a rate, so it can be missing from
 * a reading whose moment is not, and it is left out rather than sent as a nought.
 */
function toComputeUsage(app: AppRow): ComputeUsage | null {
  if (
    app.memory_total_bytes === null ||
    app.memory_used_bytes === null ||
    app.compute_measured_at === null
  ) {
    return null;
  }
  return {
    memoryTotalBytes: Number(app.memory_total_bytes),
    memoryUsedBytes: Number(app.memory_used_bytes),
    ...(app.cpu_share === null ? {} : { cpuShare: app.cpu_share }),
    measuredAt: toTimestamp(app.compute_measured_at),
  };
}

function toPublicApp({ app, hostnames }: AppWithHostnames): PublicApp {
  return {
    id: app.id,
    ownerId: app.owner_id,
    slug: app.slug,
    hostnames: hostnames.map(toAppHostname),
    config: toAppConfig(app),
    volumeUsage: toVolumeUsage(app),
    computeUsage: toComputeUsage(app),
    state: app.state,
    createdAt: toTimestamp(app.created_at),
    updatedAt: toTimestamp(app.updated_at),
  };
}
