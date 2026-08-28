import {
  type AppConfig,
  DEFAULT_HEALTH_CHECK,
  DEFAULT_HTTP_PORT,
  DEFAULT_INSTANCE_RESOURCES,
  DEFAULT_RESTART_POLICY,
  REDACTED,
  type SecretString,
  type TenantEnvironment,
  type TenantEnvironmentPatch,
} from '@repo/protocol';
import type { Queries } from '#db/queries.gen.ts';
import type { SealedEnvironment } from '#lib/tenant-secrets.ts';

// Every app gets the same filesystem for now, so this is a constant rather than a column: a
// value an owner cannot vary is one there is nothing to store per app.
export const VOLUME_SIZE_BYTES = 8_589_934_592;

// An owner reads which variables are set, never what they hold: the values are sealed in the
// database and only opened where desired state is built, so there is nothing here to return.
export type RedactedEnvironment = Record<string, typeof REDACTED>;

export type PublicAppConfig = Omit<AppConfig, 'environment'> & {
  volumeSizeBytes: number;
  environment: RedactedEnvironment;
};

// How the binary is started, which is the whole of what an owner chooses. The machine it starts
// on — vCPUs, memory, filesystem, health probe, restart budget — is nibrun's, and leaving it out
// of this one type is what keeps it out of every write shape below.
type OwnedAppConfig = Pick<AppConfig, 'httpPort' | 'args'>;

// What an app is created with: the whole environment, because there is not yet one to edit.
export type NewAppConfig = Partial<OwnedAppConfig> & {
  environment?: TenantEnvironment | undefined;
};

// `environment` is an edit, where `args` is always the whole list: a deploy states its arguments
// every time and can restate none of its secrets, so a variable it says nothing about is one it
// is leaving alone.
export type AppConfigPatch = Partial<OwnedAppConfig> & {
  environment?: TenantEnvironmentPatch | undefined;
};

export type StoredAppConfig = Omit<PublicAppConfig, 'environment'> & {
  environment: SealedEnvironment;
};

/**
 * What a patch does to an app's environment: the variables it sets, sealed, and the ones it
 * removes. Anything it named neither way is untouched — which is most of them.
 */
export type SealedEnvironmentPatch = {
  set: SealedEnvironment;
  removed: readonly string[];
};

// What a repository takes, as against what an owner sent. Every one of these is a record of
// strings, so the branding on `TenantEnvironment` and `SealedSecret` is the only thing standing
// between a plaintext value, a `[redacted]` placeholder and the ciphertext that may be stored.
export type SealedConfigPatch = Partial<OwnedAppConfig> & {
  environment?: SealedEnvironmentPatch | undefined;
};

/** The two halves of an edit: what it sets, and the names it takes away. */
export function splitEnvironmentPatch(environment: TenantEnvironmentPatch): {
  set: TenantEnvironment;
  removed: string[];
} {
  const set: Record<string, SecretString> = {};
  const removed: string[] = [];

  for (const [name, value] of Object.entries(environment)) {
    if (value === null) {
      removed.push(name);
    } else {
      set[name] = value;
    }
  }

  return { set, removed };
}

// Keys named once here, types taken from the schema, so renaming a column fails to compile
// rather than silently reading undefined.
export type RunConfigColumns = Pick<
  Queries['SelectAppById'],
  | 'http_port'
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
    resources: DEFAULT_INSTANCE_RESOURCES,
    healthCheck: DEFAULT_HEALTH_CHECK,
    restartPolicy: DEFAULT_RESTART_POLICY,
    httpPort: patch.httpPort ?? DEFAULT_HTTP_PORT,
    args: patch.args ?? [],
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
    httpPort: row.http_port,
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
