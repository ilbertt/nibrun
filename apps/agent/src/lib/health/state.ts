import type { HealthCheck, InstanceState, Timestamp } from '@repo/protocol';
import type { UnitStatus } from '#lib/vm/unit-status.ts';

const NO_PROBES = 0;
const ONE_PROBE = 1;

/**
 * How often a tenant that has never answered is asked again.
 *
 * `intervalMs` is a liveness cadence for something already serving, and spending it on a boot
 * means the gap between a binary starting to listen and a deploy being called done is most of
 * that interval. This is the grid a first answer lands on instead, and it is why the status
 * loop ticks at the same rate while anything is coming up.
 */
export const STARTUP_PROBE_INTERVAL_MS = 250;

export type HealthTracker = {
  readonly consecutiveSuccesses: number;
  readonly consecutiveFailures: number;
  readonly everHealthy: boolean;
  readonly lastHealthyAt?: Timestamp;
};

export const initialTracker = (): HealthTracker => ({
  consecutiveSuccesses: NO_PROBES,
  consecutiveFailures: NO_PROBES,
  everHealthy: false,
});

/**
 * `everHealthy` flips at the threshold, not at the first accepted connection: it is what later
 * decides whether a failure run reads as `unhealthy` or as an app that never served at all.
 */
export function applyProbe({
  tracker,
  healthy,
  at,
  healthyThreshold,
}: {
  tracker: HealthTracker;
  healthy: boolean;
  at: Timestamp;
  healthyThreshold: number;
}): HealthTracker {
  if (!healthy) {
    return {
      ...tracker,
      consecutiveSuccesses: NO_PROBES,
      consecutiveFailures: tracker.consecutiveFailures + ONE_PROBE,
    };
  }
  const consecutiveSuccesses = tracker.consecutiveSuccesses + ONE_PROBE;
  return {
    ...tracker,
    consecutiveSuccesses,
    consecutiveFailures: NO_PROBES,
    everHealthy: tracker.everHealthy || consecutiveSuccesses >= healthyThreshold,
    lastHealthyAt: at,
  };
}

type GraceInputs = {
  healthCheck: HealthCheck;
  startedAtMs?: number;
  nowMs: number;
};

/** An instance with no start time has not been booted by this agent, so nothing has run out yet. */
export function isWithinGracePeriod({ healthCheck, startedAtMs, nowMs }: GraceInputs): boolean {
  return startedAtMs === undefined || nowMs - startedAtMs < healthCheck.gracePeriodMs;
}

/**
 * The fast grid applies only while a tenant is still owed its grace period, so a slow starter
 * is failed on exactly the schedule it was before: `unhealthyThreshold` probes at `intervalMs`
 * after the grace runs out.
 */
export function nextProbeDelayMs({
  tracker,
  ...grace
}: GraceInputs & { tracker: HealthTracker }): number {
  return !tracker.everHealthy && isWithinGracePeriod(grace)
    ? Math.min(STARTUP_PROBE_INTERVAL_MS, grace.healthCheck.intervalMs)
    : grace.healthCheck.intervalMs;
}

export type LifecycleInputs = {
  unit: UnitStatus;
  tracker: HealthTracker;
  healthCheck: HealthCheck;
  desiredRunning: boolean;
  stopRequested: boolean;
  startedAtMs?: number;
  nowMs: number;
};

/**
 * A booted microVM is not a running app: `starting` has not accepted a connection and `running`
 * has, and collapsing the two would let a deploy swap traffic onto a booted-but-dead VM.
 *
 * A VM that exited unasked is `failed` and never restarted here — the guest owns the tenant's
 * restart budget, and whether to try elsewhere is the reconciler's call.
 */
export function evaluateInstanceState({
  unit,
  tracker,
  healthCheck,
  desiredRunning,
  stopRequested,
  startedAtMs,
  nowMs,
}: LifecycleInputs): InstanceState {
  if (unit.failed) {
    return 'failed';
  }
  if (!unit.active) {
    if (stopRequested || !desiredRunning) {
      return 'stopped';
    }
    return unit.loaded || startedAtMs !== undefined ? 'failed' : 'pending';
  }
  if (stopRequested) {
    return 'stopping';
  }
  if (tracker.consecutiveSuccesses >= healthCheck.healthyThreshold) {
    return 'running';
  }
  const withinGrace = isWithinGracePeriod({ healthCheck, startedAtMs, nowMs });
  if (tracker.consecutiveFailures >= healthCheck.unhealthyThreshold && !withinGrace) {
    return tracker.everHealthy ? 'unhealthy' : 'failed';
  }
  return tracker.everHealthy ? 'running' : 'starting';
}
