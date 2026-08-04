import {
  type AppConfig,
  DEFAULT_GUEST_PORT,
  DEFAULT_HEALTH_CHECK,
  DEFAULT_INSTANCE_RESOURCES,
  DEFAULT_RESTART_POLICY,
} from '@repo/protocol';
import type { Queries } from '#db/queries.gen.d.ts';

// Every app gets the same filesystem for now, so this is a constant rather than a column: a
// value an owner cannot vary is one there is nothing to store per app.
export const VOLUME_SIZE_BYTES = 8_589_934_592;

// Secrets storage is deferred, so `environment` is not a column and never reaches the api.
// Whatever builds desired state supplies it at that boundary.
type OwnedAppConfig = Omit<AppConfig, 'environment'>;

export type PublicAppConfig = OwnedAppConfig & { volumeSizeBytes: number };

export type AppConfigPatch = Partial<OwnedAppConfig>;

// Keys named once here, types taken from the schema, so renaming a column fails to compile
// rather than silently reading undefined.
export type AppConfigColumns = Pick<
  Queries['SelectAppById'],
  | 'guest_port'
  | 'args'
  | 'vcpu_count'
  | 'memory_mib'
  | 'health_check_path'
  | 'health_check_interval_ms'
  | 'health_check_timeout_ms'
  | 'health_check_grace_period_ms'
  | 'health_check_healthy_threshold'
  | 'health_check_unhealthy_threshold'
  | 'restart_max_restarts'
  | 'restart_initial_backoff_ms'
  | 'restart_max_backoff_ms'
  | 'restart_backoff_factor'
  | 'restart_reset_after_ms'
>;

export function configWithDefaults(patch: AppConfigPatch = {}): PublicAppConfig {
  return {
    volumeSizeBytes: VOLUME_SIZE_BYTES,
    guestPort: patch.guestPort ?? DEFAULT_GUEST_PORT,
    args: patch.args ?? [],
    resources: patch.resources ?? DEFAULT_INSTANCE_RESOURCES,
    healthCheck: patch.healthCheck ?? DEFAULT_HEALTH_CHECK,
    restartPolicy: patch.restartPolicy ?? DEFAULT_RESTART_POLICY,
  };
}

// Field by field rather than a spread, so a config field added later fails to compile here
// instead of reaching the guest as undefined.
export function toAppConfig(row: AppConfigColumns): PublicAppConfig {
  return {
    volumeSizeBytes: VOLUME_SIZE_BYTES,
    guestPort: row.guest_port,
    args: row.args,
    resources: {
      vcpuCount: row.vcpu_count,
      memoryMib: row.memory_mib,
    },
    healthCheck: {
      ...(row.health_check_path !== null && { path: row.health_check_path }),
      intervalMs: row.health_check_interval_ms,
      timeoutMs: row.health_check_timeout_ms,
      gracePeriodMs: row.health_check_grace_period_ms,
      healthyThreshold: row.health_check_healthy_threshold,
      unhealthyThreshold: row.health_check_unhealthy_threshold,
    },
    restartPolicy: {
      maxRestarts: row.restart_max_restarts,
      initialBackoffMs: row.restart_initial_backoff_ms,
      maxBackoffMs: row.restart_max_backoff_ms,
      backoffFactor: row.restart_backoff_factor,
      resetAfterMs: row.restart_reset_after_ms,
    },
  };
}
