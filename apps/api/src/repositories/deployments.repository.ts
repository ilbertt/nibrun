import type { AppId, ArtifactId, DeploymentId, OwnerId } from '@repo/protocol';
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
}

export class DeploymentsRepository extends Repository implements DeploymentsRepositoryContract {
  /**
   * The app's config id is pinned rather than its contents copied: `app_configs` never changes
   * a row, so the deployment keeps what it was launched with while a later patch moves the app
   * on to a new version.
   *
   * Creating one is asking for it to run — there is no second call that means it — so whatever
   * the app was running is superseded here. `deployments_live_idx` admits one live row per app,
   * so it has to leave in this same transaction or the insert below meets it.
   */
  insert({ appId, artifactId, ownerId }: CreateDeploymentInput): Promise<DeploymentRow | null> {
    return this.sql.begin(async (tx) => {
      // Asked before anything is written, and matching exactly what the insert below requires:
      // returning from this callback commits, so a stand-down followed by an insert that turned
      // out to match nothing would stop a healthy app on behalf of a request that failed.
      const [deployable] = await tx.SelectDeployableApp`
        SELECT a.id
        FROM nibrun.apps a
        JOIN nibrun.artifacts ar ON ar.app_id = a.id
        JOIN LATERAL (
          SELECT id FROM nibrun.app_configs c
          WHERE c.app_id = a.id ORDER BY c.id DESC LIMIT 1
        ) c ON true
        WHERE a.id = ${appId} AND a.owner_id = ${ownerId} AND ar.id = ${artifactId}
      `;
      if (!deployable) {
        return null;
      }

      await tx.SupersedeLiveDeployment`
        UPDATE nibrun.deployments d
        SET state = 'superseded'
        FROM nibrun.apps a
        WHERE a.id = d.app_id
          AND d.app_id = ${appId}
          AND a.owner_id = ${ownerId}
          AND d.state NOT IN ('superseded', 'failed')
      `;

      // INSERT … SELECT rather than VALUES: an app the caller does not own matches no row and
      // the statement writes nothing, where a bare ${appId} would trust a path parameter.
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
   * Rolling back: makes an existing deployment the live one again.
   *
   * `deployments_live_idx` admits one live row per app, so the outgoing deployment has to be
   * superseded before the incoming one is revived — one transaction, so no moment exists in
   * which the app has two live deployments or none.
   */
  activate({ appId, deploymentId, ownerId }: DeploymentByIdInput): Promise<DeploymentRow | null> {
    return this.sql.begin(async (tx) => {
      // The EXISTS guard is what stops a deployment id naming nothing from superseding the one
      // that is running.
      await tx.SupersedeReplacedDeployment`
        UPDATE nibrun.deployments d
        SET state = 'superseded'
        FROM nibrun.apps a
        WHERE a.id = d.app_id
          AND d.app_id = ${appId}
          AND a.owner_id = ${ownerId}
          AND d.state NOT IN ('superseded', 'failed')
          AND d.id <> ${deploymentId}
          AND EXISTS (
            SELECT 1 FROM nibrun.deployments incoming
            WHERE incoming.id = ${deploymentId} AND incoming.app_id = a.id
          )
      `;

      // Back to `pending`: it is asked for again and no host has started it yet, which is what
      // that state means. Whatever it reported the last time it ran is not true any more.
      const [row] = await tx.RunDeployment`
        /* @notNull created_at */
        UPDATE nibrun.deployments d
        SET state = 'pending'
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
}
