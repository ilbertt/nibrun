import type { App, AppHostname, AppId, OwnerId } from '@repo/protocol';
import {
  type AppConfigPatch,
  configWithDefaults,
  type PublicAppConfig,
  toAppConfig,
} from '#lib/app-config.ts';
import { platformHostname } from '#lib/app-hostname.ts';
import { deriveAppSlug } from '#lib/app-slug.ts';
import { ConflictError, NotFoundError } from '#lib/errors.ts';
import { isUniqueViolation } from '#lib/pg-errors.ts';
import { toTimestamp } from '#lib/timestamp.ts';
import type {
  AppHostnameRow,
  AppRow,
  AppsRepositoryContract,
} from '#repositories/apps.repository.ts';
import { Service } from '#services/service.ts';

export type PublicApp = Omit<App, 'config'> & { config: PublicAppConfig };

type AppWithHostnames = { app: AppRow; hostnames: readonly AppHostnameRow[] };

type OwnedApp = { appId: AppId; ownerId: OwnerId };

// Both are unique platform-wide and both are minted from the same label, so either one coming
// back as taken means the same thing: this roll of the dice is spent.
const SLUG_CONSTRAINTS = ['apps_slug_key', 'app_hostnames_hostname_key'];

// Six characters of base32 make a collision vanishingly rare, so exhausting this many rolls is
// a signal that something other than luck is wrong.
const MAX_SLUG_ATTEMPTS = 5;

export class AppsService extends Service {
  private readonly appsRepo: AppsRepositoryContract;
  private readonly appHostDomain: string;

  constructor({
    appsRepo,
    appHostDomain,
  }: {
    appsRepo: AppsRepositoryContract;
    appHostDomain: string;
  }) {
    super();
    this.appsRepo = appsRepo;
    this.appHostDomain = appHostDomain;
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
    const appConfig = configWithDefaults(config);

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

  async list({ ownerId }: { ownerId: OwnerId }): Promise<PublicApp[]> {
    const [apps, hostnames] = await Promise.all([
      this.appsRepo.listByOwner({ ownerId }),
      this.appsRepo.listHostnamesByOwner({ ownerId }),
    ]);
    const byApp = Map.groupBy(hostnames, (row) => row.app_id);

    return apps.map((app) => toPublicApp({ app, hostnames: byApp.get(app.id) ?? [] }));
  }

  async get({ appId, ownerId }: OwnedApp): Promise<PublicApp> {
    const [app, hostnames] = await Promise.all([
      this.appsRepo.findById({ appId, ownerId }),
      this.appsRepo.listHostnamesByApp({ appId, ownerId }),
    ]);

    return toPublicApp({ app: requireApp(app), hostnames });
  }

  async updateConfig({
    appId,
    ownerId,
    patch,
  }: OwnedApp & { patch: AppConfigPatch }): Promise<PublicApp> {
    const app = requireApp(await this.appsRepo.updateConfig({ appId, ownerId, patch }));
    const hostnames = await this.appsRepo.listHostnamesByApp({ appId, ownerId });

    return toPublicApp({ app, hostnames });
  }

  /**
   * The row stays behind: tearing an app down is the agent's work, the owner follows it through
   * this same state, and the slug must never be handed to a second app whatever happens.
   */
  async delete({ appId, ownerId }: OwnedApp): Promise<PublicApp> {
    const app = requireApp(await this.appsRepo.updateState({ appId, ownerId, state: 'deleting' }));
    const hostnames = await this.appsRepo.listHostnamesByApp({ appId, ownerId });

    return toPublicApp({ app, hostnames });
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

function toAppHostname(row: AppHostnameRow): AppHostname {
  return { hostname: row.hostname, kind: row.kind };
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
