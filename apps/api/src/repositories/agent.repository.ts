import type { TypedSQL, TypedTransactionSQL } from '@ilbertt/bun-sqlgen';
import type {
  HostDesiredState,
  HostId,
  HostReportedState,
  HostState,
  SecretString,
  Timestamp,
} from '@repo/protocol';
import type { Queries } from '#db/queries.gen.ts';
import { AgentSessions } from '#lib/agent/sessions.ts';
import {
  environmentByDeployment,
  hostnamesByApp,
  toDesiredInstance,
  toDesiredVolume,
} from '#lib/deployments/desired-state.ts';
import { environmentByExport, toDesiredExport } from '#lib/exports/desired-state.ts';
import type { TenantSecretsKey } from '#lib/tenant-secrets.ts';
import { Repository } from '#repositories/repository.ts';

/**
 * The last thing a host said about itself, which is the whole of what this end knows about one
 * between two reports. Kept rather than the report itself: nothing here is a substitute for the
 * tables the report's contents land in, and holding those twice is how they come apart.
 */
export type HostObservation = {
  hostId: HostId;
  reportedAt: Timestamp;
  state: HostState;
};

export abstract class AgentRepositoryContract {
  abstract registerHost(input: { originId: string }): Promise<HostId>;
  abstract hostForIdentity(input: { identity: string }): Promise<HostId | undefined>;
  abstract saveSession(input: {
    sessionToken: SecretString;
    hostId: HostId;
    expiresAt: Date;
  }): Promise<void>;
  abstract hostForSession(input: { sessionToken: string }): Promise<HostId | undefined>;
  abstract desiredState(input: { hostId: HostId }): Promise<HostDesiredState>;
  abstract hasUnplacedDeployments(): Promise<boolean>;
  abstract observeReport(input: { reported: HostReportedState }): Promise<void>;
  abstract lastObservation(): Promise<HostObservation | undefined>;
}

export class AgentRepository extends Repository implements AgentRepositoryContract {
  readonly #sessions = new AgentSessions();
  readonly #secretsKey: TenantSecretsKey;
  #lastObservation: HostObservation | undefined;

  constructor({ sql, secretsKey }: { sql: TypedSQL<Queries>; secretsKey: TenantSecretsKey }) {
    super(sql);
    this.#secretsKey = secretsKey;
  }

  async registerHost({ originId }: { originId: string }): Promise<HostId> {
    const existing = await this.hostForIdentity({ identity: originId });
    if (existing !== undefined) {
      return existing;
    }
    const [registered] = await this.sql.RegisterHost`
      INSERT INTO nibrun.hosts (origin_id) VALUES (${originId})
      ON CONFLICT (origin_id) DO UPDATE SET origin_id = EXCLUDED.origin_id
      RETURNING id
    `;
    if (registered === undefined) {
      throw new Error('Host registration returned no identity.');
    }
    return registered.id;
  }

  async hostForIdentity({ identity }: { identity: string }): Promise<HostId | undefined> {
    // Existing agents persist the returned id and present it instead of their original identity.
    const [host] = await this.sql.SelectHostForIdentity`
      SELECT id FROM nibrun.hosts
      WHERE id::text = ${identity} OR origin_id = ${identity}
      ORDER BY (id::text = ${identity}) DESC
      LIMIT 1
    `;
    return host?.id;
  }

  saveSession({
    sessionToken,
    hostId,
    expiresAt,
  }: {
    sessionToken: SecretString;
    hostId: HostId;
    expiresAt: Date;
  }): Promise<void> {
    this.#sessions.open({ sessionToken, hostId, expiresAt });
    return Promise.resolve();
  }

  hostForSession({ sessionToken }: { sessionToken: string }): Promise<HostId | undefined> {
    return Promise.resolve(this.#sessions.hostFor({ sessionToken, now: new Date() }));
  }

  async hasUnplacedDeployments(): Promise<boolean> {
    const [row] = await this.sql.SelectUnplacedDeployment`
      SELECT d.id FROM nibrun.deployments d
      WHERE d.host_id IS NULL
        AND d.app_id IN (SELECT app_id FROM nibrun.desired_volumes)
        AND NOT EXISTS (
          SELECT 1 FROM nibrun.deployments newer
          WHERE newer.app_id = d.app_id AND newer.id > d.id
        )
      LIMIT 1
    `;
    return row !== undefined;
  }

  async observeReport({ reported }: { reported: HostReportedState }): Promise<void> {
    this.#lastObservation = {
      hostId: reported.hostId,
      reportedAt: reported.reportedAt,
      state: reported.state,
    };
    await this.sql.ObserveHostReport`
      UPDATE nibrun.hosts
      SET reported_state = ${reported.state}, last_seen_at = now()
      WHERE id = ${reported.hostId}
    `;
  }

  lastObservation(): Promise<HostObservation | undefined> {
    return Promise.resolve(this.#lastObservation);
  }

  desiredState({ hostId }: { hostId: HostId }): Promise<HostDesiredState> {
    // A handoff must not split one desired document across two host assignments.
    return this.sql.begin('ISOLATION LEVEL REPEATABLE READ, READ ONLY', (sql) =>
      this.selectDesiredState({ sql, hostId }),
    );
  }

  private async selectDesiredState({
    sql,
    hostId,
  }: {
    sql: TypedTransactionSQL<Queries>;
    hostId: HostId;
  }): Promise<HostDesiredState> {
    // An artifact still awaiting its upload cannot be deployed or exported — the deployment
    // that would name it is refused — so what reaches a host here always has its bytes.
    //
    // Together rather than one after another: none of them reads what another returns, and this
    // runs on every poll of every host.
    const [deployments, volumes, hostnameRows, environmentRows, exports, exportEnvironmentRows] =
      await Promise.all([
        sql.SelectDesiredDeployments`
          /* @notNull digest */
          /* @notNull size_bytes */
          /* @notNull object_key */
          SELECT id, app_id, state,
                 digest, size_bytes, object_key, original_file_name,
                 http_port, has_extra_public_port, args, vcpu_count, memory_mib,
                 health_check_path, health_check_interval_ms, health_check_timeout_ms,
                 health_check_grace_period_ms, health_check_healthy_threshold,
                 health_check_unhealthy_threshold,
                 restart_max_restarts, restart_initial_backoff_ms, restart_max_backoff_ms,
                 restart_backoff_factor, restart_reset_after_ms, config_id,
                 activation, idle_timeout_ms, deployment_state
          FROM nibrun.desired_deployments
          WHERE id IN (SELECT deployment_id FROM nibrun.app_hosts WHERE host_id = ${hostId})
        `,
        sql.SelectDesiredVolumes`
          SELECT v.app_id, v.state,
                 v.seed_digest, v.seed_size_bytes, v.seed_object_key, v.seed_original_file_name,
                 s.volume_storage_endpoint, s.volume_storage_bucket, s.volume_storage_prefix,
                 s.volume_storage_region, s.volume_storage_auth_kind, s.volume_storage_access_key_id,
                 s.volume_storage_secret_access_key, s.volume_storage_session_token,
                 s.volume_storage_encryption_password
          FROM nibrun.desired_volumes v
          LEFT JOIN LATERAL (
            SELECT c.volume_storage_endpoint, c.volume_storage_bucket, c.volume_storage_prefix,
                   c.volume_storage_region, c.volume_storage_auth_kind, c.volume_storage_access_key_id,
                   c.volume_storage_secret_access_key, c.volume_storage_session_token,
                   c.volume_storage_encryption_password
            FROM nibrun.deployments d
            JOIN nibrun.app_configs c ON c.id = d.config_id
            WHERE d.app_id = v.app_id
            ORDER BY d.id DESC
            LIMIT 1
          ) s ON true
          WHERE v.app_id IN (SELECT app_id FROM nibrun.app_hosts WHERE host_id = ${hostId})
        `,
        sql.SelectDesiredHostnames`
          SELECT app_id, hostname, kind FROM nibrun.desired_hostnames
          WHERE app_id IN (SELECT app_id FROM nibrun.app_hosts WHERE host_id = ${hostId})
        `,
        sql.SelectDesiredEnvironment`
          SELECT deployment_id, name, value FROM nibrun.desired_environment
          WHERE deployment_id IN (SELECT deployment_id FROM nibrun.app_hosts WHERE host_id = ${hostId})
        `,
        sql.SelectDesiredExports`
          /* @notNull artifact_object_key */
          /* @notNull digest */
          /* @notNull size_bytes */
          SELECT id, app_id, object_key, state,
                 digest, size_bytes, artifact_object_key, original_file_name, config_id
          FROM nibrun.desired_exports
          WHERE app_id IN (SELECT app_id FROM nibrun.app_hosts WHERE host_id = ${hostId})
        `,
        sql.SelectDesiredExportEnvironment`
          SELECT export_id, name, value FROM nibrun.desired_export_environment
          WHERE export_id IN (
            SELECT e.id FROM nibrun.exports e
            JOIN nibrun.app_hosts h ON h.app_id = e.app_id
            WHERE h.host_id = ${hostId}
          )
        `,
      ]);

    const hostnames = hostnamesByApp(hostnameRows);
    const environments = environmentByDeployment(environmentRows);
    const exportEnvironments = environmentByExport(exportEnvironmentRows);

    return {
      hostId,
      volumes: volumes.map((row) => toDesiredVolume({ row, secretsKey: this.#secretsKey })),
      instances: deployments.map((row) =>
        toDesiredInstance({ row, hostnames, environments, secretsKey: this.#secretsKey }),
      ),
      checkpoints: [],
      exports: exports.map((row) =>
        toDesiredExport({ row, environments: exportEnvironments, secretsKey: this.#secretsKey }),
      ),
    };
  }
}
