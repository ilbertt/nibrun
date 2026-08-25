import type { TypedSQL } from '@ilbertt/bun-sqlgen';
import type { HostDesiredState, HostId, SecretString } from '@repo/protocol';
import type { Queries } from '#db/queries.gen.ts';
import {
  environmentByDeployment,
  hostnamesByApp,
  toDesiredInstance,
  toDesiredVolume,
} from '#lib/deployments/desired-state.ts';
import { environmentByExport, toDesiredExport } from '#lib/exports/desired-state.ts';
import type { TenantSecretsKey } from '#lib/tenant-secrets.ts';
import { Repository } from '#repositories/repository.ts';

export abstract class AgentRepositoryContract {
  abstract saveSession(input: { sessionToken: SecretString; hostId: HostId }): Promise<void>;
  abstract hostForSession(input: { sessionToken: string }): Promise<HostId | undefined>;
  abstract desiredState(input: { hostId: HostId }): Promise<HostDesiredState>;
}

export class AgentRepository extends Repository implements AgentRepositoryContract {
  readonly #hostBySession = new Map<string, HostId>();
  readonly #secretsKey: TenantSecretsKey;

  constructor({ sql, secretsKey }: { sql: TypedSQL<Queries>; secretsKey: TenantSecretsKey }) {
    super(sql);
    this.#secretsKey = secretsKey;
  }

  saveSession({
    sessionToken,
    hostId,
  }: {
    sessionToken: SecretString;
    hostId: HostId;
  }): Promise<void> {
    this.#hostBySession.set(sessionToken, hostId);
    return Promise.resolve();
  }

  hostForSession({ sessionToken }: { sessionToken: string }): Promise<HostId | undefined> {
    return Promise.resolve(this.#hostBySession.get(sessionToken));
  }

  /**
   * The same state for whichever host asks. Hosts are not modelled and there is one, so the id
   * here is the one the agent registered under rather than one this end assigned.
   *
   * `checkpoints` is empty until it has a table to be requested through: it is per-request work,
   * so a host can only be told to do one once something has recorded that someone asked.
   */
  async desiredState({ hostId }: { hostId: HostId }): Promise<HostDesiredState> {
    // An artifact still awaiting its upload cannot be deployed or exported — the deployment
    // that would name it is refused — so what reaches a host here always has its bytes.
    //
    // Together rather than one after another: none of them reads what another returns, and this
    // runs on every poll of every host.
    const [deployments, volumes, hostnameRows, environmentRows, exports, exportEnvironmentRows] =
      await Promise.all([
        this.sql.SelectDesiredDeployments`
          /* @notNull digest */
          /* @notNull size_bytes */
          /* @notNull object_key */
          SELECT id, app_id, state,
                 digest, size_bytes, object_key, original_file_name,
                 guest_port, args, vcpu_count, memory_mib,
                 health_check_path, health_check_interval_ms, health_check_timeout_ms,
                 health_check_grace_period_ms, health_check_healthy_threshold,
                 health_check_unhealthy_threshold,
                 restart_max_restarts, restart_initial_backoff_ms, restart_max_backoff_ms,
                 restart_backoff_factor, restart_reset_after_ms, config_id
          FROM nibrun.desired_deployments
        `,
        this.sql.SelectDesiredVolumes`
          SELECT app_id, state FROM nibrun.desired_volumes
        `,
        this.sql.SelectDesiredHostnames`
          SELECT app_id, hostname, kind FROM nibrun.desired_hostnames
        `,
        this.sql.SelectDesiredEnvironment`
          SELECT deployment_id, name, value FROM nibrun.desired_environment
        `,
        this.sql.SelectDesiredExports`
          /* @notNull object_key */
          /* @notNull artifact_object_key */
          /* @notNull digest */
          /* @notNull size_bytes */
          SELECT id, app_id, object_key, state,
                 digest, size_bytes, artifact_object_key, original_file_name, config_id
          FROM nibrun.desired_exports
        `,
        this.sql.SelectDesiredExportEnvironment`
          SELECT export_id, name, value FROM nibrun.desired_export_environment
        `,
      ]);

    const hostnames = hostnamesByApp(hostnameRows);
    const environments = environmentByDeployment(environmentRows);
    const exportEnvironments = environmentByExport(exportEnvironmentRows);

    return {
      hostId,
      volumes: volumes.map(toDesiredVolume),
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
