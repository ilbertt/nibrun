import type { ArtifactId, Deployment } from '@repo/protocol';
import { type PublicAppConfig, toAppConfig } from '#lib/app-config.ts';
import { ConflictError, NotFoundError } from '#lib/errors.ts';
import { isUniqueViolation } from '#lib/pg-errors.ts';
import { toTimestamp } from '#lib/timestamp.ts';
import type {
  DeploymentByIdInput,
  DeploymentRow,
  DeploymentsByAppInput,
  DeploymentsRepositoryContract,
  OwnedApp,
  RollbackDeploymentInput,
} from '#repositories/deployments.repository.ts';
import { Service } from '#services/service.ts';

const LIVE_DEPLOYMENT_CONSTRAINT = 'deployments_live_idx';

export type PublicDeployment = Omit<Deployment, 'config'> & { config: PublicAppConfig };

/**
 * An artifact to run, or a release to go back to. Which of the two a request is saying decides
 * where the artifact and the config come from, and nothing else about it differs.
 */
export type DeploymentSource =
  | { artifactId: ArtifactId }
  | Pick<RollbackDeploymentInput, 'rollbackOf'>;

export class DeploymentsService extends Service {
  private readonly deploymentsRepo: DeploymentsRepositoryContract;

  constructor({ deploymentsRepo }: { deploymentsRepo: DeploymentsRepositoryContract }) {
    super();
    this.deploymentsRepo = deploymentsRepo;
  }

  /**
   * Creating a deployment is asking for it to run — there is no second call that means it — so
   * this stands down whatever the app was running. Going back to an older release is the same
   * request naming that release, and this is where the body decides which of the two it is.
   *
   * What comes back is still `pending`: a host has to boot it and say so.
   */
  createOrRollback({
    source,
    ...owned
  }: OwnedApp & { source: DeploymentSource }): Promise<PublicDeployment> {
    if ('rollbackOf' in source) {
      return this.published(
        this.deploymentsRepo.insertRollback({ ...owned, rollbackOf: source.rollbackOf }),
      );
    }
    return this.published(this.deploymentsRepo.insert({ ...owned, artifactId: source.artifactId }));
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
   * Both ways of asking end here. A source the caller does not own wrote nothing, which is a
   * 404 rather than a 403 — a deployment they cannot see must not be confirmed to exist. Two
   * callers racing meet `deployments_live_idx` rather than each other, so the loser is told to
   * retry instead of leaving the app with two live deployments.
   */
  private async published(write: Promise<DeploymentRow | null>): Promise<PublicDeployment> {
    const row = await write.catch((error: unknown) => {
      if (isUniqueViolation({ error, constraint: LIVE_DEPLOYMENT_CONSTRAINT })) {
        throw new ConflictError('Another deployment for this app is being started.');
      }
      throw error;
    });
    if (!row) {
      throw new NotFoundError('App, artifact or deployment not found.');
    }
    return toPublicDeployment(row);
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
    ...(row.rollback_of_deployment_id && { rollbackOf: row.rollback_of_deployment_id }),
  };
}
