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

const RUNNING_DEPLOYMENT_CONSTRAINT = 'deployments_running_idx';

export type PublicDeployment = Omit<Deployment, 'config'> & { config: PublicAppConfig };

export class DeploymentsService extends Service {
  private readonly deploymentsRepo: DeploymentsRepositoryContract;

  constructor({ deploymentsRepo }: { deploymentsRepo: DeploymentsRepositoryContract }) {
    super();
    this.deploymentsRepo = deploymentsRepo;
  }

  async create(input: CreateDeploymentInput): Promise<PublicDeployment> {
    const row = await this.deploymentsRepo.insert(input);
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
   * Asks for `deploymentId` to be the one the app runs. Rolling back is the same request naming
   * an older deployment, which the pinned config makes an exact replay rather than a rebuild.
   *
   * What comes back still carries whatever state the deployment is observed in: a host has to
   * boot it and say so, so answering `active` here would be a guess.
   */
  async activate(input: DeploymentByIdInput): Promise<PublicDeployment> {
    const row = await this.activateRow(input);
    if (!row) {
      throw new NotFoundError('Deployment not found.');
    }
    return toPublicDeployment(row);
  }

  // Two callers racing to activate meet deployments_running_idx rather than each other, so the
  // loser is told to retry instead of leaving the app asking for two microVMs.
  private async activateRow(input: DeploymentByIdInput): Promise<DeploymentRow | null> {
    try {
      return await this.deploymentsRepo.activate(input);
    } catch (error) {
      if (isUniqueViolation({ error, constraint: RUNNING_DEPLOYMENT_CONSTRAINT })) {
        throw new ConflictError('Another deployment for this app is being activated.');
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
