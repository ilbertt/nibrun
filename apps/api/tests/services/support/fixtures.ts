import {
  AppIdSchema,
  ArtifactIdSchema,
  DEFAULT_GUEST_PORT,
  DEFAULT_HEALTH_CHECK,
  DEFAULT_INSTANCE_RESOURCES,
  DEFAULT_RESTART_POLICY,
  DeploymentIdSchema,
  OwnerIdSchema,
  Value,
} from '@repo/protocol';
import { type AppConfigColumns, type PublicAppConfig, VOLUME_SIZE_BYTES } from '#lib/app-config.ts';
import type {
  DeploymentByIdInput,
  DeploymentLookup,
  DeploymentRow,
} from '#repositories/deployments.repository.ts';

export const OWNER_ID = Value.Parse(OwnerIdSchema, 'owner-1');
export const OTHER_OWNER_ID = Value.Parse(OwnerIdSchema, 'owner-2');
export const APP_ID = Value.Parse(AppIdSchema, 'app-1');
export const ARTIFACT_ID = Value.Parse(ArtifactIdSchema, 'artifact-1');
export const DEPLOYMENT_ID = Value.Parse(DeploymentIdSchema, 'deployment-1');

export const APP_HOST_DOMAIN = 'apps.test';

// A service reading a log store or a host's filesystem asks Postgres one question — may this
// caller see this deployment — and never reads the row, so this is the whole of what it needs.
export const A_DEPLOYMENT_ROW = {} as DeploymentRow;

export function deploymentLookup(
  row: DeploymentRow | null,
): DeploymentLookup & { asked: DeploymentByIdInput[] } {
  const asked: DeploymentByIdInput[] = [];
  return {
    asked,
    findById(input) {
      asked.push(input);
      return Promise.resolve(row);
    },
  };
}

// Spelled out from the protocol's own defaults rather than built with `configWithDefaults`,
// which is the thing under test wherever this is the expected value.
export const DEFAULT_CONFIG: PublicAppConfig = {
  volumeSizeBytes: VOLUME_SIZE_BYTES,
  guestPort: DEFAULT_GUEST_PORT,
  args: [],
  resources: DEFAULT_INSTANCE_RESOURCES,
  healthCheck: DEFAULT_HEALTH_CHECK,
  restartPolicy: DEFAULT_RESTART_POLICY,
};

/** The inverse of `toAppConfig`: the `app_configs` columns a row carries for this config. */
export function configColumns(config: PublicAppConfig): AppConfigColumns {
  return {
    guest_port: config.guestPort,
    args: [...config.args],
    vcpu_count: config.resources.vcpuCount,
    memory_mib: config.resources.memoryMib,
    health_check_path: config.healthCheck.path ?? null,
    health_check_interval_ms: config.healthCheck.intervalMs,
    health_check_timeout_ms: config.healthCheck.timeoutMs,
    health_check_grace_period_ms: config.healthCheck.gracePeriodMs,
    health_check_healthy_threshold: config.healthCheck.healthyThreshold,
    health_check_unhealthy_threshold: config.healthCheck.unhealthyThreshold,
    restart_max_restarts: config.restartPolicy.maxRestarts,
    restart_initial_backoff_ms: config.restartPolicy.initialBackoffMs,
    restart_max_backoff_ms: config.restartPolicy.maxBackoffMs,
    restart_backoff_factor: config.restartPolicy.backoffFactor,
    restart_reset_after_ms: config.restartPolicy.resetAfterMs,
  };
}
