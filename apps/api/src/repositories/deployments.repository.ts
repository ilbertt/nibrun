import type { TypedSQL } from '@ilbertt/bun-sqlgen';
import type { AppId, ArtifactId, DeploymentId, OwnerId } from '@repo/protocol';
import type { Queries } from '#db/queries.gen.d.ts';
import { Repository } from '#repositories/repository.ts';

export type DeploymentRow = Queries['SelectDeploymentById'];

export type OwnedApp = { appId: AppId; ownerId: OwnerId };

export type CreateDeploymentInput = OwnedApp & { artifactId: ArtifactId };

/**
 * Going back to a release is a new row naming the one it replays, rather than that one revived:
 * a deployment never moves backwards, and the history keeps both the release and the rollback.
 */
export type RollbackDeploymentInput = OwnedApp & { rollbackOf: DeploymentId };

type Transaction = TypedSQL<Queries>;

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
  abstract insertRollback(input: RollbackDeploymentInput): Promise<DeploymentRow | null>;
  abstract listByApp(input: DeploymentsByAppInput): Promise<DeploymentRow[]>;
  abstract findById(input: DeploymentByIdInput): Promise<DeploymentRow | null>;
}

export class DeploymentsRepository extends Repository implements DeploymentsRepositoryContract {
  /**
   * The app's config id is pinned rather than its contents copied: `app_configs` never changes
   * a row, so the deployment keeps what it was launched with while a later patch moves the app
   * on to a new version.
   *
   * Creating one is asking for it to run — there is no second call that means it — so whatever
   * the app was running is superseded first. `deployments_live_idx` admits one live row per app,
   * so it has to leave in this same transaction or the insert meets it.
   */
  insert({ appId, ownerId, artifactId }: CreateDeploymentInput): Promise<DeploymentRow | null> {
    return this.sql.begin(async (tx) => {
      // Asked before anything is superseded: returning from this callback commits, so an
      // artifact this owner does not have must leave the running deployment alone rather than
      // stand it down on behalf of a request that goes on to write nothing.
      const [deployable] = await tx.SelectDeployableArtifact`
        SELECT ar.id
        FROM nibrun.artifacts ar
        JOIN nibrun.apps a ON a.id = ar.app_id
        WHERE ar.id = ${artifactId} AND ar.app_id = ${appId} AND a.owner_id = ${ownerId}
      `;
      if (!deployable) {
        return null;
      }
      await this.supersedeLive({ tx, appId, ownerId });

      // INSERT … SELECT rather than VALUES, so the predicate that decides ownership is the one
      // the row is written through rather than one checked beside it.
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
      return inserted ? await this.selectDeployment({ tx, deploymentId: inserted.id }) : null;
    });
  }

  /**
   * Replays an earlier deployment as a new one, taking both the artifact and the config it
   * pinned. `app_configs` never changes a row, so that is the release as it ran rather than
   * that artifact rebuilt against today's configuration.
   *
   * The deployment being replayed is matched through the app the caller owns, so one belonging
   * to another app is not a deployment this request can name.
   */
  insertRollback({
    appId,
    ownerId,
    rollbackOf,
  }: RollbackDeploymentInput): Promise<DeploymentRow | null> {
    return this.sql.begin(async (tx) => {
      const [replayable] = await tx.SelectDeploymentToReplay`
        SELECT d.id
        FROM nibrun.deployments d
        JOIN nibrun.apps a ON a.id = d.app_id
        WHERE d.id = ${rollbackOf} AND d.app_id = ${appId} AND a.owner_id = ${ownerId}
      `;
      if (!replayable) {
        return null;
      }
      await this.supersedeLive({ tx, appId, ownerId });

      const [inserted] = await tx.InsertReplayedDeployment`
        INSERT INTO nibrun.deployments
          (app_id, artifact_id, config_id, rollback_of_deployment_id)
        SELECT src.app_id, src.artifact_id, src.config_id, src.id
        FROM nibrun.deployments src
        JOIN nibrun.apps a ON a.id = src.app_id
        WHERE src.id = ${rollbackOf} AND src.app_id = ${appId} AND a.owner_id = ${ownerId}
        RETURNING id
      `;
      return inserted ? await this.selectDeployment({ tx, deploymentId: inserted.id }) : null;
    });
  }

  listByApp({ appId, ownerId }: DeploymentsByAppInput): Promise<DeploymentRow[]> {
    return this.sql.SelectDeploymentsByApp`
      /* @notNull created_at */
      SELECT d.id, d.app_id, d.artifact_id, d.state, d.activated_at,
             d.rollback_of_deployment_id, d.created_at,
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
      SELECT d.id, d.app_id, d.artifact_id, d.state, d.activated_at,
             d.rollback_of_deployment_id, d.created_at,
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

  private async supersedeLive({
    tx,
    appId,
    ownerId,
  }: OwnedApp & { tx: Transaction }): Promise<void> {
    await tx.SupersedeLiveDeployment`
      UPDATE nibrun.deployments d
      SET state = 'superseded'
      FROM nibrun.apps a
      WHERE a.id = d.app_id
        AND d.app_id = ${appId}
        AND a.owner_id = ${ownerId}
        AND d.state NOT IN ('superseded', 'failed')
    `;
  }

  private async selectDeployment({
    tx,
    deploymentId,
  }: {
    tx: Transaction;
    deploymentId: DeploymentId;
  }): Promise<DeploymentRow | null> {
    const [row] = await tx.SelectInsertedDeployment`
      /* @notNull created_at */
      SELECT d.id, d.app_id, d.artifact_id, d.state, d.activated_at,
             d.rollback_of_deployment_id, d.created_at,
             c.guest_port, c.args, c.vcpu_count, c.memory_mib,
             c.health_check_path, c.health_check_interval_ms, c.health_check_timeout_ms,
             c.health_check_grace_period_ms, c.health_check_healthy_threshold,
             c.health_check_unhealthy_threshold,
             c.restart_max_restarts, c.restart_initial_backoff_ms, c.restart_max_backoff_ms,
             c.restart_backoff_factor, c.restart_reset_after_ms
      FROM nibrun.deployments d
      JOIN nibrun.app_configs c ON c.id = d.config_id
      WHERE d.id = ${deploymentId}
    `;
    return row ?? null;
  }
}
