import { Type } from '@sinclair/typebox';
import {
  AppIdSchema,
  DeploymentIdSchema,
  HostIdSchema,
  InstanceIdSchema,
  VolumeIdSchema,
} from '#domain/identifiers.ts';
import { stringEnum } from '#lib/string-enum.ts';
import {
  HostPortSchema,
  Ipv4AddressSchema,
  Sha256DigestSchema,
  TimestampSchema,
} from '#lib/wire.ts';

const MIN_VCPU_COUNT = 1;
const MAX_VCPU_COUNT = 32;
const MIN_MEMORY_MIB = 128;
const MAX_MEMORY_MIB = 16_384;

const DEFAULT_VCPU_COUNT = 1;
const DEFAULT_MEMORY_MIB = 512;

const MIN_HEALTH_PROBE_MS = 100;
const MIN_THRESHOLD = 1;
const MAX_HTTP_PATH_LENGTH = 1024;

export const InstanceResourcesSchema = Type.Object({
  vcpuCount: Type.Integer({ minimum: MIN_VCPU_COUNT, maximum: MAX_VCPU_COUNT }),
  memoryMib: Type.Integer({ minimum: MIN_MEMORY_MIB, maximum: MAX_MEMORY_MIB }),
});

export type InstanceResources = typeof InstanceResourcesSchema.static;

export const DEFAULT_INSTANCE_RESOURCES: InstanceResources = {
  vcpuCount: DEFAULT_VCPU_COUNT,
  memoryMib: DEFAULT_MEMORY_MIB,
};

// Run by the agent against the guest port the user declared. A bare TCP connect is the
// default because that is precisely the question being asked — is the tenant's process
// accepting connections — and it needs nothing of the tenant. A path upgrades the probe to
// an HTTP GET that must answer 2xx.
export const HealthCheckSchema = Type.Object({
  path: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_HTTP_PATH_LENGTH })),
  intervalMs: Type.Integer({ minimum: MIN_HEALTH_PROBE_MS }),
  timeoutMs: Type.Integer({ minimum: MIN_HEALTH_PROBE_MS }),
  gracePeriodMs: Type.Integer({ minimum: 0 }),
  healthyThreshold: Type.Integer({ minimum: MIN_THRESHOLD }),
  unhealthyThreshold: Type.Integer({ minimum: MIN_THRESHOLD }),
});

export type HealthCheck = typeof HealthCheckSchema.static;

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

// Applied by the guest's init to the tenant process, not by the agent to the microVM. When
// the budget is exhausted the guest powers itself off and the agent reports the instance
// `failed` rather than booting it again — deciding whether to try elsewhere is the
// reconciler's call, and a host that retries forever on its own hides a broken deploy.
export const RestartPolicySchema = Type.Object({
  maxRestarts: Type.Integer({ minimum: 0 }),
  initialBackoffMs: Type.Integer({ minimum: 0 }),
  maxBackoffMs: Type.Integer({ minimum: 0 }),
  backoffFactor: Type.Number({ minimum: 1 }),
  // A process that stayed up this long is treated as healthy and its restart count resets,
  // so an app that crashes once a month does not eventually exhaust a lifetime budget.
  resetAfterMs: Type.Integer({ minimum: 0 }),
});

export type RestartPolicy = typeof RestartPolicySchema.static;

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

// `starting` is a booted microVM whose tenant process has not yet accepted a connection, and
// `running` is one that has. Collapsing the two would let a deploy swap traffic onto a
// booted-but-dead VM, which is worse than a deploy that fails.
export const INSTANCE_STATES = [
  'pending',
  'starting',
  'running',
  'unhealthy',
  'stopping',
  'stopped',
  'failed',
] as const;

export const InstanceStateSchema = stringEnum(INSTANCE_STATES);

export type InstanceState = typeof InstanceStateSchema.static;

export const InstanceSchema = Type.Object({
  id: InstanceIdSchema,
  appId: AppIdSchema,
  deploymentId: DeploymentIdSchema,
  volumeId: VolumeIdSchema,
  hostId: HostIdSchema,
  state: InstanceStateSchema,
  artifactDigest: Sha256DigestSchema,
  // Allocated by the agent and stable for the lifetime of the app, so a redeploy is invisible
  // to the routing layer: same host, same port, new process behind it.
  hostPort: Type.Optional(HostPortSchema),
  guestIpv4: Type.Optional(Ipv4AddressSchema),
  restartCount: Type.Integer({ minimum: 0 }),
  createdAt: TimestampSchema,
  startedAt: Type.Optional(TimestampSchema),
  lastHealthyAt: Type.Optional(TimestampSchema),
});

export type Instance = typeof InstanceSchema.static;
