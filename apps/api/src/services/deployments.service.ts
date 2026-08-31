import type {
  ArtifactId,
  Deployment,
  DeploymentId,
  DeploymentState,
  HostReportedState,
  ReportedInstance,
  Timestamp,
} from '@repo/protocol';
import { schema } from '#db/queries.gen.ts';
import { type PublicAppConfig, toAppConfig } from '#lib/app-config.ts';
import { DeploymentLifecycle } from '#lib/deployments/lifecycle.ts';
import { ConflictError, NotFoundError } from '#lib/errors.ts';
import { isUniqueViolation } from '#lib/pg-errors.ts';
import { toTimestamp } from '#lib/timestamp.ts';
import type {
  DeploymentByIdInput,
  DeploymentRow,
  DeploymentsByAppInput,
  DeploymentsRepositoryContract,
  OwnedApp,
  ReportedDeployment,
  RollbackDeploymentInput,
} from '#repositories/deployments.repository.ts';
import { Service } from '#services/service.ts';

const LIVE_DEPLOYMENT_CONSTRAINT = schema.deployments._indexes.deployments_live_idx._indexName;

const NEVER_STARTED = 'No host started this deployment in time.';

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
   * A host's report, read as what it says about each release it is running.
   *
   * Every live deployment is considered rather than only the ones the report names: one no
   * instance has appeared for is exactly the case a startup deadline exists for, and it is
   * knowable only by looking at the deployments the report left out.
   */
  async applyHostReport({ reported }: { reported: HostReportedState }): Promise<void> {
    const instances = new Map(
      reported.instances.map((instance) => [instance.deploymentId, instance]),
    );
    const now = new Date();
    const live = await this.deploymentsRepo.listLive();

    const observed: ReportedDeployment[] = [];
    const activated: DeploymentId[] = [];
    const overdue: DeploymentId[] = [];

    for (const row of live) {
      const instance = instances.get(row.id);
      const state = new DeploymentLifecycle({
        state: row.state,
        desiredRunning: row.desired_running,
        createdAt: row.created_at,
        stateChangedAt: row.state_changed_at,
      }).advanceState({ reported: instance, now });

      if (state !== row.state) {
        this.logger.info('deployment state changed', {
          deploymentId: row.id,
          from: row.state,
          to: state,
        });
        if (state === 'running') {
          activated.push(row.id);
        }
      }
      if (instance) {
        observed.push(toReportedDeployment({ instance, state }));
      } else if (state === 'failed') {
        overdue.push(row.id);
      }
    }

    await this.deploymentsRepo.applyReport({ reported: observed });
    for (const deploymentId of activated) {
      await this.deploymentsRepo.stampActivation({
        deploymentId,
        at: servedFrom({ instance: instances.get(deploymentId), reportedAt: reported.reportedAt }),
      });
    }
    for (const deploymentId of overdue) {
      await this.deploymentsRepo.fail({ deploymentId, message: NEVER_STARTED });
    }
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

/**
 * The probe the tenant first answered, which the host saw and this end hears about a report
 * later — so it is taken off the report rather than from this clock. An instance only reaches
 * `running` by answering one, so `reportedAt` stands in for a host that sends none anyway.
 */
function servedFrom({
  instance,
  reportedAt,
}: {
  instance: ReportedInstance | undefined;
  reportedAt: Timestamp;
}): Date {
  return new Date(instance?.lastHealthyAt ?? reportedAt);
}

function toReportedDeployment({
  instance,
  state,
}: {
  instance: ReportedInstance;
  state: DeploymentState;
}): ReportedDeployment {
  return {
    deploymentId: instance.deploymentId,
    state,
    instanceState: instance.state,
    hostPort: instance.hostPort ?? null,
    guestIpv4: instance.guestIpv4 ?? null,
    publicIpv4: instance.publicIpv4 ?? null,
    extraPublicPort: instance.extraPublicPort ?? null,
    restartCount: instance.restartCount,
    message: instance.message ?? null,
    startedAt: instance.startedAt ? new Date(instance.startedAt) : null,
    lastHealthyAt: instance.lastHealthyAt ? new Date(instance.lastHealthyAt) : null,
  };
}

function toPublicDeployment(row: DeploymentRow): PublicDeployment {
  return {
    id: row.id,
    appId: row.app_id,
    artifactId: row.artifact_id,
    config: toAppConfig(row),
    state: row.state,
    createdAt: toTimestamp(row.created_at),
    restartCount: row.restart_count,
    ...(row.instance_state && { instanceState: row.instance_state }),
    ...(row.public_ipv4 && { publicIpv4: row.public_ipv4 }),
    ...(row.extra_public_port && { extraPublicPort: row.extra_public_port }),
    ...(row.started_at && { startedAt: toTimestamp(row.started_at) }),
    ...(row.activated_at && { activatedAt: toTimestamp(row.activated_at) }),
    ...(row.last_healthy_at && { lastHealthyAt: toTimestamp(row.last_healthy_at) }),
    ...(row.message && { message: row.message }),
    ...(row.rollback_of_deployment_id && { rollbackOf: row.rollback_of_deployment_id }),
  };
}
