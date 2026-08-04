import type { Deployment } from '@repo/protocol';
import { type PublicAppConfig, toAppConfig } from '#lib/app-config.ts';
import { ConflictError, NotFoundError } from '#lib/errors.ts';
import { isUniqueViolation } from '#lib/pg-errors.ts';
import { toTimestamp } from '#lib/timestamp.ts';
import type {
  CreateDeploymentInput,
  DeploymentByIdInput,
  DeploymentRow,
  DeploymentsByAppInput,
  DeploymentsRepositoryContract,
} from '#repositories/deployments.repository.ts';
import { Service } from '#services/service.ts';

const LIVE_DEPLOYMENT_CONSTRAINT = 'deployments_live_idx';

export type PublicDeployment = Omit<Deployment, 'config'> & { config: PublicAppConfig };

export class DeploymentsService extends Service {
  private readonly deploymentsRepo: DeploymentsRepositoryContract;

  constructor({ deploymentsRepo }: { deploymentsRepo: DeploymentsRepositoryContract }) {
    super();
    this.deploymentsRepo = deploymentsRepo;
  }

  /**
   * Creating a deployment is asking for it to run — there is no second call that means it — so
   * this stands down whatever the app was running.
   *
   * What comes back is still `pending`: a host has to boot it and say so.
   */
  async create(input: CreateDeploymentInput): Promise<PublicDeployment> {
    const row = await this.claimLive(() => this.deploymentsRepo.insert(input));
    if (!row) {
      throw new NotFoundError('App or artifact not found.');
    }
    return toPublicDeployment(row);
  }

  async list(input: DeploymentsByAppInput): Promise<PublicDeployment[]> {
    const rows = await this.deploymentsRepo.listByApp(input);
    return rows.map(toPublicDeployment);
  }

  async get(input: DeploymentByIdInput): Promise<PublicDeployment> {
    const row = await this.deploymentsRepo.findById(input);
    if (!row) {
      throw new NotFoundError('Deployment not found.');
    }
    return toPublicDeployment(row);
  }

  /**
   * Rolling back: makes an existing deployment the one the app runs again. Creating already
   * asks for what it created, so this only ever names a row that is already there, and the
   * config that row pinned is what makes the replay exact rather than a rebuild.
   *
   * What comes back carries whatever state the deployment is observed in, not the one asked
   * for — a host has to boot it and say so.
   */
  async activate(input: DeploymentByIdInput): Promise<PublicDeployment> {
    const row = await this.claimLive(() => this.deploymentsRepo.activate(input));
    if (!row) {
      throw new NotFoundError('Deployment not found.');
    }
    return toPublicDeployment(row);
  }

  // Two callers racing to run a deployment meet deployments_live_idx rather than each other, so
  // the loser is told to retry instead of leaving the app with two live deployments.
  private async claimLive(
    write: () => Promise<DeploymentRow | null>,
  ): Promise<DeploymentRow | null> {
    try {
      return await write();
    } catch (error) {
      if (isUniqueViolation({ error, constraint: LIVE_DEPLOYMENT_CONSTRAINT })) {
        throw new ConflictError('Another deployment for this app is being started.');
      }
      throw error;
    }
  }
}

function toPublicDeployment(row: DeploymentRow): PublicDeployment {
  return {
    id: row.id,
    appId: row.app_id,
    artifactId: row.artifact_id,
    config: toAppConfig(row),
    state: row.state,
    createdAt: toTimestamp(row.created_at),
    ...(row.activated_at && { activatedAt: toTimestamp(row.activated_at) }),
  };
}
