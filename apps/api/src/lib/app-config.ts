import {
  type AppConfig,
  DEFAULT_GUEST_PORT,
  DEFAULT_HEALTH_CHECK,
  DEFAULT_INSTANCE_RESOURCES,
  DEFAULT_RESTART_POLICY,
  REDACTED,
  type TenantEnvironment,
} from '@repo/protocol';
import type { Queries } from '#db/queries.gen.d.ts';
import type { SealedEnvironment } from '#lib/tenant-secrets.ts';

// Every app gets the same filesystem for now, so this is a constant rather than a column: a
// value an owner cannot vary is one there is nothing to store per app.
export const VOLUME_SIZE_BYTES = 8_589_934_592;

// An owner reads which variables are set, never what they hold: the values are sealed in the
// database and only opened where desired state is built, so there is nothing here to return.
export type RedactedEnvironment = Record<string, typeof REDACTED>;

type OwnedAppConfig = Omit<AppConfig, 'environment'>;

export type PublicAppConfig = OwnedAppConfig & {
  volumeSizeBytes: number;
  environment: RedactedEnvironment;
};

// `environment` absent means leave it as it is, where an absent `args` means the same as an empty
// one. They differ because a deploy always states its arguments and almost never restates a
// secret — and restating one it could not read would be how an owner erases it by accident.
export type AppConfigPatch = Partial<OwnedAppConfig> & {
  environment?: TenantEnvironment | undefined;
};

export type StoredAppConfig = Omit<PublicAppConfig, 'environment'> & {
  environment: SealedEnvironment;
};

// What a repository takes, as against what an owner sent. Every one of these is a record of
// strings, so the branding on `TenantEnvironment` and `SealedSecret` is the only thing standing
// between a plaintext value, a `[redacted]` placeholder and the ciphertext that may be stored.
export type SealedConfigPatch = Partial<OwnedAppConfig> & {
  environment?: SealedEnvironment | undefined;
};

// Keys named once here, types taken from the schema, so renaming a column fails to compile
// rather than silently reading undefined.
export type RunConfigColumns = Pick<
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

export type AppConfigColumns = RunConfigColumns &
  Pick<Queries['SelectAppById'], 'environment_names'>;

// Everything but the environment, which only the caller holding the key can supply in the one
// form the database accepts.
export function configWithDefaults(
  patch: AppConfigPatch = {},
): Omit<PublicAppConfig, 'environment'> {
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
    ...toRunConfig(row),
    volumeSizeBytes: VOLUME_SIZE_BYTES,
    environment: redacted(row.environment_names),
  };
}

// Everything an instance runs with except the environment, which reaches this end as names in one
// place and as sealed values in another, and is put back on by whichever caller has which.
export function toRunConfig(row: RunConfigColumns): Omit<AppConfig, 'environment'> {
  return {
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

function redacted(names: readonly string[]): RedactedEnvironment {
  return Object.fromEntries(names.map((name) => [name, REDACTED]));
}
