import type {
  AppId,
  ArtifactId,
  DeploymentId,
  DeploymentState,
  InstanceState,
  OwnerId,
  ReportedInstance,
} from '@repo/protocol';
import type { Queries } from '#db/queries.gen.d.ts';
import { Repository } from '#repositories/repository.ts';

export type DeploymentRow = Queries['SelectDeploymentById'];

export type CreateDeploymentInput = {
  appId: AppId;
  artifactId: ArtifactId;
  ownerId: OwnerId;
};

export type DeploymentByIdInput = {
  appId: AppId;
  deploymentId: DeploymentId;
  ownerId: OwnerId;
};

export type DeploymentsByAppInput = {
  appId: AppId;
  ownerId: OwnerId;
};

export abstract class DeploymentsRepositoryContract {
  abstract insert(input: CreateDeploymentInput): Promise<DeploymentRow | null>;
  abstract listByApp(input: DeploymentsByAppInput): Promise<DeploymentRow[]>;
  abstract findById(input: DeploymentByIdInput): Promise<DeploymentRow | null>;
  abstract activate(input: DeploymentByIdInput): Promise<DeploymentRow | null>;
  abstract applyReport(input: { instances: ReportedInstance[] }): Promise<void>;
}

export class DeploymentsRepository extends Repository implements DeploymentsRepositoryContract {
  // The app's config id is pinned rather than its contents copied: `app_configs` never changes
  // a row, so the deployment keeps what it was launched with while a later patch moves the app
  // on to a new version.
  //
  // INSERT … SELECT rather than VALUES: an app the caller does not own matches no row and the
  // statement writes nothing, where a bare ${appId} would trust a path parameter.
  insert({ appId, artifactId, ownerId }: CreateDeploymentInput): Promise<DeploymentRow | null> {
    return this.sql.begin(async (tx) => {
      const [inserted] = await tx.InsertDeployment`
        INSERT INTO nibrun.deployments (app_id, artifact_id, config_id)
        SELECT a.id, ar.id, c.id
        FROM nibrun.apps a
        JOIN nibrun.artifacts ar ON ar.app_id = a.id
        JOIN LATERAL (
          SELECT id FROM nibrun.app_configs c
          WHERE c.app_id = a.id ORDER BY c.id DESC LIMIT 1
        ) c ON true
        WHERE a.id = ${appId} AND a.owner_id = ${ownerId} AND ar.id = ${artifactId}
        RETURNING id
      `;
      if (!inserted) {
        return null;
      }

      const [row] = await tx.SelectInsertedDeployment`
        /* @notNull created_at */
        SELECT d.id, d.app_id, d.artifact_id, d.state, d.activated_at, d.created_at,
               c.guest_port, c.args, c.vcpu_count, c.memory_mib,
               c.health_check_path, c.health_check_interval_ms, c.health_check_timeout_ms,
               c.health_check_grace_period_ms, c.health_check_healthy_threshold,
               c.health_check_unhealthy_threshold,
               c.restart_max_restarts, c.restart_initial_backoff_ms, c.restart_max_backoff_ms,
               c.restart_backoff_factor, c.restart_reset_after_ms
        FROM nibrun.deployments d
        JOIN nibrun.app_configs c ON c.id = d.config_id
        WHERE d.id = ${inserted.id}
      `;
      return row ?? null;
    });
  }

  listByApp({ appId, ownerId }: DeploymentsByAppInput): Promise<DeploymentRow[]> {
    return this.sql.SelectDeploymentsByApp`
      /* @notNull created_at */
      SELECT d.id, d.app_id, d.artifact_id, d.state, d.activated_at, d.created_at,
               c.guest_port, c.args, c.vcpu_count, c.memory_mib,
               c.health_check_path, c.health_check_interval_ms, c.health_check_timeout_ms,
               c.health_check_grace_period_ms, c.health_check_healthy_threshold,
               c.health_check_unhealthy_threshold,
               c.restart_max_restarts, c.restart_initial_backoff_ms, c.restart_max_backoff_ms,
               c.restart_backoff_factor, c.restart_reset_after_ms
      FROM nibrun.deployments d
      JOIN nibrun.apps a ON a.id = d.app_id
      JOIN nibrun.app_configs c ON c.id = d.config_id
      WHERE d.app_id = ${appId} AND a.owner_id = ${ownerId}
      ORDER BY d.id DESC
    `;
  }

  async findById({
    appId,
    deploymentId,
    ownerId,
  }: DeploymentByIdInput): Promise<DeploymentRow | null> {
    const [row] = await this.sql.SelectDeploymentById`
      /* @notNull created_at */
      SELECT d.id, d.app_id, d.artifact_id, d.state, d.activated_at, d.created_at,
               c.guest_port, c.args, c.vcpu_count, c.memory_mib,
               c.health_check_path, c.health_check_interval_ms, c.health_check_timeout_ms,
               c.health_check_grace_period_ms, c.health_check_healthy_threshold,
               c.health_check_unhealthy_threshold,
               c.restart_max_restarts, c.restart_initial_backoff_ms, c.restart_max_backoff_ms,
               c.restart_backoff_factor, c.restart_reset_after_ms
      FROM nibrun.deployments d
      JOIN nibrun.apps a ON a.id = d.app_id
      JOIN nibrun.app_configs c ON c.id = d.config_id
      WHERE d.app_id = ${appId} AND d.id = ${deploymentId} AND a.owner_id = ${ownerId}
    `;
    return row ?? null;
  }

  /**
   * Asks for this deployment to be the one the app runs.
   *
   * `state` is deliberately untouched: it is what a host reports back, and writing it here
   * would answer a question only the host can answer. What activation owns is the wish.
   *
   * `deployments_running_idx` admits one wish per app, so the outgoing deployment has to be
   * stood down before the incoming one is asked for — one transaction, so no moment exists in
   * which the app is asking for two microVMs or for none.
   */
  activate({ appId, deploymentId, ownerId }: DeploymentByIdInput): Promise<DeploymentRow | null> {
    return this.sql.begin(async (tx) => {
      // The EXISTS guard is what stops a deployment id naming nothing from standing down the
      // one that is running.
      await tx.StopReplacedDeployment`
        UPDATE nibrun.deployments d
        SET desired_state = 'stopped'
        FROM nibrun.apps a
        WHERE a.id = d.app_id
          AND d.app_id = ${appId}
          AND a.owner_id = ${ownerId}
          AND d.desired_state = 'running'
          AND d.id <> ${deploymentId}
          AND EXISTS (
            SELECT 1 FROM nibrun.deployments incoming
            WHERE incoming.id = ${deploymentId} AND incoming.app_id = a.id
          )
      `;

      const [row] = await tx.RunDeployment`
        /* @notNull created_at */
        UPDATE nibrun.deployments d
        SET desired_state = 'running'
        FROM nibrun.apps a, nibrun.app_configs c
        WHERE a.id = d.app_id
          AND c.id = d.config_id
          AND d.app_id = ${appId}
          AND d.id = ${deploymentId}
          AND a.owner_id = ${ownerId}
        RETURNING d.id, d.app_id, d.artifact_id, d.state, d.activated_at, d.created_at,
                  c.guest_port, c.args, c.vcpu_count, c.memory_mib,
                  c.health_check_path, c.health_check_interval_ms, c.health_check_timeout_ms,
                  c.health_check_grace_period_ms, c.health_check_healthy_threshold,
                  c.health_check_unhealthy_threshold,
                  c.restart_max_restarts, c.restart_initial_backoff_ms, c.restart_max_backoff_ms,
                  c.restart_backoff_factor, c.restart_reset_after_ms
      `;
      return row ?? null;
    });
  }

  /**
   * Takes what a host says it is running.
   *
   * One deployment is one microVM, so the reported instance id is the deployment id and there
   * is nothing to match up. Nothing is inserted: an instance the control plane never asked for
   * is one the host is about to be told to stop, and giving it a row would make it real.
   *
   * Superseding comes first because `deployments_active_idx` admits one active row per app, so
   * the outgoing deployment has to leave before the incoming one arrives.
   */
  async applyReport({ instances }: { instances: ReportedInstance[] }): Promise<void> {
    if (instances.length === 0) {
      return;
    }
    const running = instances.filter((instance) => instance.state === RUNNING).map(idOf);

    await this.sql.begin(async (tx) => {
      await tx.SupersedeReplacedDeployments`
        UPDATE nibrun.deployments d
        SET state = 'superseded'
        FROM nibrun.deployments incoming
        WHERE incoming.id = ANY(${running})
          AND incoming.app_id = d.app_id
          AND d.id <> incoming.id
          AND d.state = 'active'
      `;

      for (const instance of instances) {
        await tx.UpdateDeploymentFromReport`
          UPDATE nibrun.deployments SET
            state = ${observedState(instance.state)},
            host_port = ${instance.hostPort ?? null},
            guest_ipv4 = ${instance.guestIpv4 ?? null},
            restart_count = ${instance.restartCount},
            message = ${instance.message ?? null},
            started_at = ${instance.startedAt ?? null},
            last_healthy_at = ${instance.lastHealthyAt ?? null},
            activated_at = CASE
              WHEN ${instance.state} = 'running' AND activated_at IS NULL THEN now()
              ELSE activated_at
            END
          WHERE id = ${instance.instanceId}
        `;
      }
    });
  }
}

const RUNNING: InstanceState = 'running';

function idOf(instance: ReportedInstance): DeploymentId {
  return instance.instanceId as string as DeploymentId;
}

/**
 * What a microVM is doing, said in the vocabulary a deployment has.
 *
 * `unhealthy` reads as `starting` rather than `failed`: the restart policy is still working on
 * it, and a deployment marked failed while its guest is being restarted is one an owner would
 * roll back for no reason.
 */
function observedState(state: InstanceState): DeploymentState {
  switch (state) {
    case 'pending':
      return 'pending';
    case 'running':
      return 'active';
    case 'failed':
      return 'failed';
    case 'stopping':
    case 'stopped':
      return 'superseded';
    default:
      return 'starting';
  }
}
