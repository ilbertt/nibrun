import type { App, AppId, OwnerId, ReportedVolume } from '@repo/protocol';
import {
  type AppConfigPatch,
  configWithDefaults,
  type PublicAppConfig,
  type SealedConfigPatch,
  toAppConfig,
} from '#lib/app-config.ts';
import { type PublicAppHostname, platformHostname, toAppHostname } from '#lib/app-hostname.ts';
import { deriveAppSlug } from '#lib/app-slug.ts';
import { ConflictError, NotFoundError } from '#lib/errors.ts';
import { isUniqueViolation } from '#lib/pg-errors.ts';
import { sealEnvironment, type TenantSecretsKey } from '#lib/tenant-secrets.ts';
import { toTimestamp } from '#lib/timestamp.ts';
import type {
  AppHostnameRow,
  AppHostnamesRepositoryContract,
} from '#repositories/app-hostnames.repository.ts';
import type { AppRow, AppsRepositoryContract } from '#repositories/apps.repository.ts';
import type { ArtifactStorageRepositoryContract } from '#repositories/artifact-storage.repository.ts';
import type { ExportsRepositoryContract } from '#repositories/exports.repository.ts';
import { Service } from '#services/service.ts';

export type PublicApp = Omit<App, 'config' | 'hostnames'> & {
  config: PublicAppConfig;
  hostnames: PublicAppHostname[];
};

type AppWithHostnames = { app: AppRow; hostnames: readonly AppHostnameRow[] };

type OwnedApp = { appId: AppId; ownerId: OwnerId };

// Both are unique platform-wide and both are minted from the same label, so either one coming
// back as taken means the same thing: this roll of the dice is spent.
const SLUG_CONSTRAINTS = ['apps_slug_key', 'app_hostnames_hostname_key'];

// Six characters of base32 make a collision vanishingly rare, so exhausting this many rolls is
// a signal that something other than luck is wrong.
const MAX_SLUG_ATTEMPTS = 5;

/** Reading them back is all an app needs of its hostnames; the rest is the hostnames' own. */
export type AppHostnameReads = Pick<AppHostnamesRepositoryContract, 'listByOwner' | 'listByApp'>;

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
  private readonly hostnamesRepo: AppHostnameReads;
  private readonly exportsRepo: ExportCancellation;
  private readonly artifactStorageRepo: ObjectRemoval;
  private readonly exportStorageRepo: ObjectRemoval;
  private readonly appHostDomain: string;
  private readonly secretsKey: TenantSecretsKey;

  constructor({
    appsRepo,
    hostnamesRepo,
    exportsRepo,
    artifactStorageRepo,
    exportStorageRepo,
    appHostDomain,
    secretsKey,
  }: {
    appsRepo: AppsRepositoryContract;
    hostnamesRepo: AppHostnameReads;
    exportsRepo: ExportCancellation;
    artifactStorageRepo: ObjectRemoval;
    exportStorageRepo: ObjectRemoval;
    appHostDomain: string;
    secretsKey: TenantSecretsKey;
  }) {
    super();
    this.appsRepo = appsRepo;
    this.hostnamesRepo = hostnamesRepo;
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
    config?: AppConfigPatch;
  }): Promise<PublicApp> {
    const appConfig = {
      ...configWithDefaults(config),
      environment: sealEnvironment({
        key: this.secretsKey,
        environment: config?.environment ?? {},
      }),
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

  // Absent stays absent: the repository reads that as "carry the previous version's" rather than
  // as an empty environment, which is what stops a deploy that says nothing erasing a secret.
  private sealed({ environment, ...rest }: AppConfigPatch): SealedConfigPatch {
    return {
      ...rest,
      ...(environment !== undefined && {
        environment: sealEnvironment({ key: this.secretsKey, environment }),
      }),
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
    const app = requireApp(
      await this.appsRepo.updateConfig({ appId, ownerId, patch: this.sealed(patch) }),
    );
    const hostnames = await this.hostnamesRepo.listByApp({ appId, ownerId });

    return toPublicApp({ app, hostnames });
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
    const app = requireApp(await this.appsRepo.updateState({ appId, ownerId, state: 'deleting' }));
    await this.exportsRepo.failInFlight({ appId, message: APP_DELETED });
    const [torndown, hostnames] = await Promise.all([
      this.finishIfNothingToTearDown({ appId }),
      this.hostnamesRepo.listByApp({ appId, ownerId }),
    ]);

    return toPublicApp({ app: torndown ? { ...app, state: 'deleted' } : app, hostnames });
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

// An app the caller does not own is indistinguishable from one that does not exist; a 403 would
// confirm it to a stranger.
function requireApp(app: AppRow | null): AppRow {
  if (!app) {
    throw new NotFoundError('App not found.');
  }
  return app;
}

function toPublicApp({ app, hostnames }: AppWithHostnames): PublicApp {
  return {
    id: app.id,
    ownerId: app.owner_id,
    slug: app.slug,
    hostnames: hostnames.map(toAppHostname),
    config: toAppConfig(app),
    state: app.state,
    createdAt: toTimestamp(app.created_at),
    updatedAt: toTimestamp(app.updated_at),
  };
}
