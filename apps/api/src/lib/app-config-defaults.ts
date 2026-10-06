import { DEFAULT_HTTP_PORT as DEFAULT_HTTP_PORT_NUMBER } from '@repo/api-constants';
import { type HealthCheck, HttpPortSchema, type RestartPolicy } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';

export const DEFAULT_HTTP_PORT = Value.Parse(HttpPortSchema, DEFAULT_HTTP_PORT_NUMBER);

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
