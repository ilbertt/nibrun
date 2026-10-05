import {
  type HealthCheck,
  HttpPortSchema,
  type InstanceResources,
  type RestartPolicy,
} from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';

const DEFAULT_HTTP_PORT_NUMBER = 3000;
export const DEFAULT_HTTP_PORT = Value.Parse(HttpPortSchema, DEFAULT_HTTP_PORT_NUMBER);

// Every app gets the same filesystem for now, so this is a constant rather than a column: a
// value an owner cannot vary is one there is nothing to store per app.
export const DEFAULT_VOLUME_SIZE_BYTES = 8_589_934_592;
const DEFAULT_VCPU_COUNT = 1;

// The divisor on a host's usable memory: it decides how many apps a host carries and what one
// costs. 256 leaves a Bun server several times its resident baseline while doubling density
// against the 512 it replaces. Only new apps start here — an existing one keeps the value
// already on its config, and no owner can ask for another.
const DEFAULT_MEMORY_MIB = 256;

export const DEFAULT_INSTANCE_RESOURCES: InstanceResources = {
  vcpuCount: DEFAULT_VCPU_COUNT,
  memoryMib: DEFAULT_MEMORY_MIB,
};

const DEFAULT_HEALTH_INTERVAL_MS = 5_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 2_000;
const DEFAULT_HEALTH_GRACE_PERIOD_MS = 30_000;
const DEFAULT_HEALTHY_THRESHOLD = 1;
const DEFAULT_UNHEALTHY_THRESHOLD = 3;

export const DEFAULT_HEALTH_CHECK: HealthCheck = {
  intervalMs: DEFAULT_HEALTH_INTERVAL_MS,
  timeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
  gracePeriodMs: DEFAULT_HEALTH_GRACE_PERIOD_MS,
  healthyThreshold: DEFAULT_HEALTHY_THRESHOLD,
  unhealthyThreshold: DEFAULT_UNHEALTHY_THRESHOLD,
};

const DEFAULT_MAX_RESTARTS = 5;
const DEFAULT_INITIAL_BACKOFF_MS = 500;
const DEFAULT_MAX_BACKOFF_MS = 30_000;
const DEFAULT_BACKOFF_FACTOR = 2;
const DEFAULT_RESET_AFTER_MS = 60_000;

export const DEFAULT_RESTART_POLICY: RestartPolicy = {
  maxRestarts: DEFAULT_MAX_RESTARTS,
  initialBackoffMs: DEFAULT_INITIAL_BACKOFF_MS,
  maxBackoffMs: DEFAULT_MAX_BACKOFF_MS,
  backoffFactor: DEFAULT_BACKOFF_FACTOR,
  resetAfterMs: DEFAULT_RESET_AFTER_MS,
};
