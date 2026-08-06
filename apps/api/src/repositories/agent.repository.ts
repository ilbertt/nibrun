import type { HostDesiredState, HostId, SecretString } from '@repo/protocol';
import { hostnamesByApp, toDesiredInstance, toDesiredVolume } from '#lib/desired-state.ts';
import { Repository } from '#repositories/repository.ts';

export abstract class AgentRepositoryContract {
  abstract saveSession(input: { sessionToken: SecretString; hostId: HostId }): Promise<void>;
  abstract hostForSession(input: { sessionToken: string }): Promise<HostId | undefined>;
  abstract desiredState(input: { hostId: HostId }): Promise<HostDesiredState>;
}

export class AgentRepository extends Repository implements AgentRepositoryContract {
  // In this process rather than in Postgres: a session is ephemeral, so losing the map when the
  // api restarts costs a re-registration the agent already retries.
  readonly #hostBySession = new Map<string, HostId>();

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
   * `checkpoints` and `exports` are empty until each has a table to be requested through: both
   * are per-request work, so a host can only be told to do one once something has recorded that
   * someone asked.
   */
  async desiredState({ hostId }: { hostId: HostId }): Promise<HostDesiredState> {
    const deployments = await this.sql.SelectDesiredDeployments`
      SELECT id, app_id, state,
             digest, size_bytes, object_key, original_file_name,
             guest_port, args, vcpu_count, memory_mib,
             health_check_path, health_check_interval_ms, health_check_timeout_ms,
             health_check_grace_period_ms, health_check_healthy_threshold,
             health_check_unhealthy_threshold,
             restart_max_restarts, restart_initial_backoff_ms, restart_max_backoff_ms,
             restart_backoff_factor, restart_reset_after_ms
      FROM nibrun.desired_deployments
    `;
    const hostnames = hostnamesByApp(
      await this.sql.SelectDesiredHostnames`
        SELECT app_id, hostname, kind FROM nibrun.desired_hostnames
      `,
    );

    return {
      hostId,
      volumes: deployments.map(toDesiredVolume),
      instances: deployments.map((row) => toDesiredInstance({ row, hostnames })),
      checkpoints: [],
      exports: [],
    };
  }
}
