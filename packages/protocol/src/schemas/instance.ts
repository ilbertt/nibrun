import { stringEnum } from '@repo/typebox-extensions';
import { Type } from '@sinclair/typebox';

const MIN_VCPU_COUNT = 1;
const MAX_VCPU_COUNT = 32;
const MIN_MEMORY_MIB = 128;
const MAX_MEMORY_MIB = 16_384;
const MIN_HEALTH_PROBE_MS = 100;
const MIN_THRESHOLD = 1;
const MAX_HTTP_PATH_LENGTH = 1024;

export const InstanceResourcesSchema = Type.Object({
  vcpuCount: Type.Integer({ minimum: MIN_VCPU_COUNT, maximum: MAX_VCPU_COUNT }),
  memoryMib: Type.Integer({ minimum: MIN_MEMORY_MIB, maximum: MAX_MEMORY_MIB }),
});

export type InstanceResources = typeof InstanceResourcesSchema.static;

// Run by the agent against the HTTP port the user declared. A bare TCP connect is the
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

// `starting` is a booted microVM whose tenant process has not yet accepted a connection, and
// `running` is one that has. Collapsing the two would let a deploy swap traffic onto a
// booted-but-dead VM, which is worse than a deploy that fails.
//
// `idle` is an on-request app with no microVM because nothing has asked for one. It is not
// `stopped` and the difference is load-bearing: a stopped instance is one nobody wants running,
// and one nobody wants running is a release that has finished serving. An idle one is serving —
// the next request is what it is waiting for — so the two cannot share a name.
export const INSTANCE_STATES = [
  'pending',
  'starting',
  'running',
  'unhealthy',
  'stopping',
  'stopped',
  'idle',
  'failed',
] as const;

export const InstanceStateSchema = stringEnum(INSTANCE_STATES);
export type InstanceState = typeof InstanceStateSchema.static;
