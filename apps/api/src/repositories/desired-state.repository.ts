import type { Queries } from '#db/queries.gen.d.ts';
import { Repository } from '#repositories/repository.ts';

export type RunningDeploymentRow = Queries['SelectRunningDeployments'];
export type AppVolumeRow = Queries['SelectAppVolumes'];
export type DeployedHostnameRow = Queries['SelectDeployedHostnames'];

export abstract class DesiredStateRepositoryContract {
  abstract generation(): Promise<number>;
  abstract runningDeployments(): Promise<RunningDeploymentRow[]>;
  abstract appVolumes(): Promise<AppVolumeRow[]>;
  abstract deployedHostnames(): Promise<DeployedHostnameRow[]>;
}

/**
 * What the fleet should be running, read rather than written — every write that changes it
 * belongs to the table it changes.
 *
 * Nothing here takes a host: there is one, so what a host should be running is what anyone
 * should be running. The day there are two, this is where the predicate goes.
 */
export class DesiredStateRepository extends Repository implements DesiredStateRepositoryContract {
  async generation(): Promise<number> {
    const [row] = await this.sql.SelectDesiredStateGeneration`
      SELECT d.generation FROM nibrun.desired_state d
    `;
    return row ? Number(row.generation) : 0;
  }

  // Only an active app: suspending one is what stops its microVM, and an app on its way out
  // must not be handed back to a host that would boot it again.
  runningDeployments(): Promise<RunningDeploymentRow[]> {
    return this.sql.SelectRunningDeployments`
      SELECT d.id, d.app_id,
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
      WHERE d.state NOT IN ('superseded', 'failed') AND a.state = 'active'
      ORDER BY d.id
    `;
  }

  /**
   * One filesystem per app, so there is no volume table to read: an app that has ever been
   * deployed has one, and its identity is the app's.
   *
   * Every app that has ever been deployed rather than only the ones running now, because a
   * volume outlives the deployment that created it — and because a list that shrinks is never
   * allowed to mean "delete it", so an app on its way out has to still appear here to be
   * carried out as `absent`.
   */
  appVolumes(): Promise<AppVolumeRow[]> {
    return this.sql.SelectAppVolumes`
      SELECT a.id, a.state
      FROM nibrun.apps a
      WHERE EXISTS (SELECT 1 FROM nibrun.deployments d WHERE d.app_id = a.id)
      ORDER BY a.id
    `;
  }

  deployedHostnames(): Promise<DeployedHostnameRow[]> {
    return this.sql.SelectDeployedHostnames`
      SELECT ah.app_id, ah.hostname, ah.kind
      FROM nibrun.app_hostnames ah
      JOIN nibrun.deployments d ON d.app_id = ah.app_id AND d.state NOT IN ('superseded', 'failed')
      ORDER BY ah.id
    `;
  }
}
