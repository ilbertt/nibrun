import type { TypedSQL } from '@ilbertt/bun-sqlgen';
import type {
  AppId,
  ArtifactId,
  DeploymentId,
  DeploymentState,
  HostPort,
  ImportId,
  InstanceState,
  Ipv4Address,
  OwnerId,
} from '@repo/protocol';
import type { Queries } from '#db/queries.gen.ts';
import { Repository } from '#repositories/repository.ts';

export type DeploymentRow = Queries['SelectDeploymentById'];

export type OwnedApp = { appId: AppId; ownerId: OwnerId };

/**
 * `resetDataFrom` is the archive the app's filesystem should be created holding, where one was
 * named. Null is the ordinary case and the only one an app that has ever run can be in.
 */
export type CreateDeploymentInput = OwnedApp & {
  artifactId: ArtifactId;
  resetDataFrom: ImportId | null;
};

/**
 * Why a deployment was not written, where "not found" would not be the truth.
 *
 * A rollback answers `null` because there is only one way it can fail — nothing of the caller's to
 * replay — while this one can fail three, and two of them are about an archive rather than about
 * anything being missing. An owner told "not found" about a filesystem that exists has been told
 * the wrong thing.
 */
export type CreatedDeployment =
  | { outcome: 'created'; row: DeploymentRow }
  | { outcome: 'no-artifact' }
  | { outcome: 'no-import' }
  | { outcome: 'data-exists' };

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

export type LiveDeploymentRow = Queries['SelectLiveDeployments'];

/** What a host said about the microVM, as the columns the deployment keeps it in. */
export type ReportedDeployment = {
  deploymentId: DeploymentId;
  state: DeploymentState;
  /** The microVM's own state, which the release's no longer answers: a running one can be asleep. */
  instanceState: InstanceState;
  hostPort: HostPort | null;
  guestIpv4: Ipv4Address | null;
  publicIpv4: Ipv4Address | null;
  extraPublicPort: HostPort | null;
  restartCount: number;
  message: string | null;
  startedAt: Date | null;
  lastHealthyAt: Date | null;
};

export abstract class DeploymentsRepositoryContract {
  abstract insert(input: CreateDeploymentInput): Promise<CreatedDeployment>;
  abstract insertRollback(input: RollbackDeploymentInput): Promise<DeploymentRow | null>;
  abstract listByApp(input: DeploymentsByAppInput): Promise<DeploymentRow[]>;
  abstract findById(input: DeploymentByIdInput): Promise<DeploymentRow | null>;
  abstract listLive(): Promise<LiveDeploymentRow[]>;
  abstract applyReport(input: { reported: ReportedDeployment[] }): Promise<void>;
  abstract stampActivation(input: { deploymentId: DeploymentId; at: Date }): Promise<void>;
  abstract fail(input: { deploymentId: DeploymentId; message: string }): Promise<void>;
}

/**
 * What a service reading something held elsewhere — a log store, a host's filesystem — needs from
 * here: the question of who may read it, and nothing beyond that.
 */
export type DeploymentLookup = Pick<DeploymentsRepositoryContract, 'findById'>;

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
  insert({
    appId,
    ownerId,
    artifactId,
    resetDataFrom,
  }: CreateDeploymentInput): Promise<CreatedDeployment> {
    return this.sql.begin(async (tx): Promise<CreatedDeployment> => {
      // Asked before anything is superseded: returning from this callback commits, so an
      // artifact this owner does not have must leave the running deployment alone rather than
      // stand it down on behalf of a request that goes on to write nothing.
      // `digest IS NOT NULL` is what makes an artifact one: a row without it is an upload still
      // in flight, and a host sent to fetch it would find a key that names nothing yet.
      const [deployable] = await tx.SelectDeployableArtifact`
        SELECT ar.id
        FROM nibrun.artifacts ar
        JOIN nibrun.live_apps a ON a.id = ar.app_id
        WHERE ar.id = ${artifactId} AND ar.app_id = ${appId} AND a.owner_id = ${ownerId}
          AND ar.digest IS NOT NULL
      `;
      if (!deployable) {
        return { outcome: 'no-artifact' };
      }
      const refusal =
        resetDataFrom === null
          ? undefined
          : await seedRefusal({ tx, appId, ownerId, resetDataFrom });
      if (refusal) {
        return refusal;
      }
      await this.supersedeLive({ tx, appId, ownerId });

      // INSERT … SELECT rather than VALUES, so the predicate that decides ownership is the one
      // the row is written through rather than one checked beside it.
      const [inserted] = await tx.InsertDeployment`
        INSERT INTO nibrun.deployments (app_id, artifact_id, config_id, reset_data_from_import_id)
        SELECT a.id, ar.id, c.id, ${resetDataFrom}
        FROM nibrun.live_apps a
        JOIN nibrun.artifacts ar ON ar.app_id = a.id
        JOIN LATERAL (
          SELECT id FROM nibrun.app_configs_with_environment c
          WHERE c.app_id = a.id ORDER BY c.id DESC LIMIT 1
        ) c ON true
        WHERE a.id = ${appId} AND a.owner_id = ${ownerId} AND ar.id = ${artifactId}
          AND ar.digest IS NOT NULL
        RETURNING id
      `;
      if (!inserted) {
        return { outcome: 'no-artifact' };
      }
      const row = await this.selectDeployment({ tx, deploymentId: inserted.id });
      return row ? { outcome: 'created', row } : { outcome: 'no-artifact' };
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
        JOIN nibrun.live_apps a ON a.id = d.app_id
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
        JOIN nibrun.live_apps a ON a.id = src.app_id
        WHERE src.id = ${rollbackOf} AND src.app_id = ${appId} AND a.owner_id = ${ownerId}
        RETURNING id
      `;
      return inserted ? await this.selectDeployment({ tx, deploymentId: inserted.id }) : null;
    });
  }

  listByApp({ appId, ownerId }: DeploymentsByAppInput): Promise<DeploymentRow[]> {
    return this.sql.SelectDeploymentsByApp`
      /* @notNull environment_names */
      SELECT d.id, d.app_id, d.artifact_id, d.state, d.instance_state, d.activated_at,
             d.rollback_of_deployment_id, d.created_at, d.message,
             d.started_at, d.last_healthy_at, d.restart_count,
             d.public_ipv4, d.extra_public_port,
               c.http_port, c.has_extra_public_port, c.args, c.vcpu_count, c.memory_mib,
               c.health_check_path, c.health_check_interval_ms, c.health_check_timeout_ms,
               c.health_check_grace_period_ms, c.health_check_healthy_threshold,
               c.health_check_unhealthy_threshold,
               c.restart_max_restarts, c.restart_initial_backoff_ms, c.restart_max_backoff_ms,
               c.restart_backoff_factor, c.restart_reset_after_ms, c.environment_names
      FROM nibrun.deployments d
      JOIN nibrun.live_apps a ON a.id = d.app_id
      JOIN nibrun.app_configs_with_environment c ON c.id = d.config_id
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
      /* @notNull environment_names */
      SELECT d.id, d.app_id, d.artifact_id, d.state, d.instance_state, d.activated_at,
             d.rollback_of_deployment_id, d.created_at, d.message,
             d.started_at, d.last_healthy_at, d.restart_count,
             d.public_ipv4, d.extra_public_port,
               c.http_port, c.has_extra_public_port, c.args, c.vcpu_count, c.memory_mib,
               c.health_check_path, c.health_check_interval_ms, c.health_check_timeout_ms,
               c.health_check_grace_period_ms, c.health_check_healthy_threshold,
               c.health_check_unhealthy_threshold,
               c.restart_max_restarts, c.restart_initial_backoff_ms, c.restart_max_backoff_ms,
               c.restart_backoff_factor, c.restart_reset_after_ms, c.environment_names
      FROM nibrun.deployments d
      JOIN nibrun.live_apps a ON a.id = d.app_id
      JOIN nibrun.app_configs_with_environment c ON c.id = d.config_id
      WHERE d.app_id = ${appId} AND d.id = ${deploymentId} AND a.owner_id = ${ownerId}
    `;
    return row ?? null;
  }

  /**
   * The fleet's view rather than an owner's, so there is no `ownerId` to scope on: a host is
   * told about every app it runs. `desired_running` is the app's own state read as the question
   * the deployment's clock asks — a suspended app's deployment is not late for anything.
   */
  listLive(): Promise<LiveDeploymentRow[]> {
    return this.sql.SelectLiveDeployments`
      /* @notNull desired_running */
      SELECT d.id, d.state, d.created_at, a.updated_at AS state_changed_at,
             (a.state = 'active') AS desired_running
      FROM nibrun.deployments d
      JOIN nibrun.apps a ON a.id = d.app_id
      WHERE d.state NOT IN ('superseded', 'failed')
    `;
  }

  /**
   * One statement per instance rather than one over all of them: a host runs a handful, and a
   * batch would have to name the rows it skipped for the caller to learn anything from it.
   *
   * `state` is written back even when it has not moved, so the reported columns beside it are a
   * single write. Rows that have gone terminal since the report was assembled are left alone,
   * which is what stops a report in flight from resurrecting a superseded deployment.
   *
   * Every column here is whatever the host last said. The one that is not — when the release
   * began serving — is written by `stampActivation` instead.
   */
  applyReport({ reported }: { reported: ReportedDeployment[] }): Promise<void> {
    return this.sql.begin(async (tx) => {
      for (const instance of reported) {
        await tx.ApplyReportedDeployment`
          UPDATE nibrun.deployments SET
            state = ${instance.state},
            instance_state = ${instance.instanceState},
            host_port = ${instance.hostPort},
            guest_ipv4 = ${instance.guestIpv4},
            public_ipv4 = ${instance.publicIpv4},
            extra_public_port = ${instance.extraPublicPort},
            restart_count = ${instance.restartCount},
            message = ${instance.message},
            started_at = ${instance.startedAt},
            last_healthy_at = ${instance.lastHealthyAt}
          WHERE id = ${instance.deploymentId} AND state NOT IN ('superseded', 'failed')
        `;
      }
    });
  }

  /**
   * When the release began serving, which is a thing that happens once. Every later report says
   * it is still serving and carries a newer healthy instant, so a column that took each of them
   * would end up meaning `last_healthy_at` a second time.
   *
   * `IS NULL` rather than a check around the call: two reports arriving together would both find
   * it empty, and only one of them can be the moment it started.
   */
  async stampActivation({
    deploymentId,
    at,
  }: {
    deploymentId: DeploymentId;
    at: Date;
  }): Promise<void> {
    await this.sql.StampDeploymentActivation`
      UPDATE nibrun.deployments SET activated_at = ${at}
      WHERE id = ${deploymentId} AND activated_at IS NULL
    `;
  }

  async fail({
    deploymentId,
    message,
  }: {
    deploymentId: DeploymentId;
    message: string;
  }): Promise<void> {
    await this.sql.FailDeployment`
      UPDATE nibrun.deployments SET state = 'failed', message = ${message}
      WHERE id = ${deploymentId} AND state NOT IN ('superseded', 'failed')
    `;
  }

  private async supersedeLive({
    tx,
    appId,
    ownerId,
  }: OwnedApp & { tx: Transaction }): Promise<void> {
    await tx.SupersedeLiveDeployment`
      UPDATE nibrun.deployments d
      SET state = 'superseded'
      FROM nibrun.live_apps a
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
      /* @notNull environment_names */
      SELECT d.id, d.app_id, d.artifact_id, d.state, d.instance_state, d.activated_at,
             d.rollback_of_deployment_id, d.created_at, d.message,
             d.started_at, d.last_healthy_at, d.restart_count,
             d.public_ipv4, d.extra_public_port,
             c.http_port, c.has_extra_public_port, c.args, c.vcpu_count, c.memory_mib,
             c.health_check_path, c.health_check_interval_ms, c.health_check_timeout_ms,
             c.health_check_grace_period_ms, c.health_check_healthy_threshold,
             c.health_check_unhealthy_threshold,
             c.restart_max_restarts, c.restart_initial_backoff_ms, c.restart_max_backoff_ms,
             c.restart_backoff_factor, c.restart_reset_after_ms, c.environment_names
      FROM nibrun.deployments d
      JOIN nibrun.app_configs_with_environment c ON c.id = d.config_id
      WHERE d.id = ${deploymentId}
    `;
    return row ?? null;
  }
}

/**
 * Whether the archive named may create this app's filesystem, asked inside the transaction that
 * would write the row: both answers can change between a read and a write, and one of them is a
 * host reporting a volume ready.
 *
 * `digest IS NOT NULL` is what makes an upload an archive, and `data_initialized_at IS NULL` is
 * the whole of "the filesystem does not exist yet". Refused rather than accepted and ignored: a
 * host skips a device that already carries a filesystem, so a deployment written past this would
 * be an owner told their data was replaced when nothing read the archive at all.
 */
async function seedRefusal({
  tx,
  appId,
  ownerId,
  resetDataFrom,
}: OwnedApp & { tx: Transaction; resetDataFrom: ImportId }): Promise<
  CreatedDeployment | undefined
> {
  const [app] = await tx.SelectAppAwaitingData`
    SELECT a.id
    FROM nibrun.live_apps a
    WHERE a.id = ${appId} AND a.owner_id = ${ownerId} AND a.data_initialized_at IS NULL
  `;
  if (!app) {
    return { outcome: 'data-exists' };
  }
  const [usable] = await tx.SelectUsableImport`
    SELECT im.id
    FROM nibrun.imports im
    JOIN nibrun.live_apps a ON a.id = im.app_id
    WHERE im.id = ${resetDataFrom} AND im.app_id = ${appId} AND a.owner_id = ${ownerId}
      AND im.digest IS NOT NULL
  `;
  return usable ? undefined : { outcome: 'no-import' };
}
