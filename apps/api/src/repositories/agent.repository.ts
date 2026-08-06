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
    // Read before the rows below it. A change landing in between then costs one redundant poll,
    // where the other order would hand a host old rows under a number saying it was current —
    // and it would believe it had converged until something else changed.
    const generation = await this.generation();
    const deployments = await this.sql.SelectDesiredDeployments`
      SELECT d.id, d.app_id, a.state,
             ar.digest, ar.size_bytes, ar.object_key, ar.original_file_name,
             c.guest_port, c.args, c.vcpu_count, c.memory_mib,
             c.health_check_path, c.health_check_interval_ms, c.health_check_timeout_ms,
             c.health_check_grace_period_ms, c.health_check_healthy_threshold,
             c.health_check_unhealthy_threshold,
             c.restart_max_restarts, c.restart_initial_backoff_ms, c.restart_max_backoff_ms,
             c.restart_backoff_factor, c.restart_reset_after_ms
      FROM nibrun.deployments d
      JOIN nibrun.apps a ON a.id = d.app_id
      JOIN nibrun.artifacts ar ON ar.id = d.artifact_id
      JOIN nibrun.app_configs c ON c.id = d.config_id
      WHERE d.state NOT IN ('superseded', 'failed') AND a.state IN ('active', 'suspended')
    `;
    const hostnames = hostnamesByApp(
      await this.sql.SelectDesiredHostnames`
        SELECT h.app_id, h.hostname, h.kind
        FROM nibrun.app_hostnames h
        JOIN nibrun.deployments d ON d.app_id = h.app_id
        JOIN nibrun.apps a ON a.id = h.app_id
        WHERE d.state NOT IN ('superseded', 'failed') AND a.state IN ('active', 'suspended')
      `,
    );

    return {
      hostId,
      generation,
      volumes: deployments.map(toDesiredVolume),
      instances: deployments.map((row) => toDesiredInstance({ row, hostnames })),
      checkpoints: [],
      exports: [],
    };
  }

  private async generation(): Promise<number> {
    const [row] = await this.sql.SelectDesiredStateGeneration`
      SELECT generation FROM nibrun.desired_state
    `;
    return Number(row?.generation ?? 0);
  }
}
