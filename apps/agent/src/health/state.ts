import type { HealthCheck, InstanceState, Timestamp } from '@repo/protocol';
import type { UnitStatus } from '#vm/systemd.ts';

const NO_PROBES = 0;
const ONE_PROBE = 1;

export type HealthTracker = {
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  everHealthy: boolean;
  lastHealthyAt?: Timestamp;
};

export const initialTracker = (): HealthTracker => ({
  consecutiveSuccesses: NO_PROBES,
  consecutiveFailures: NO_PROBES,
  everHealthy: false,
});

/**
 * `everHealthy` flips only once the success run reaches the threshold, not on the first
 * accepted connection. The difference decides whether a later failure run reads as `unhealthy`
 * — an app that was serving and stopped — or as `failed`, an app that never served at all.
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
 * Decides what an instance actually is, from what systemd says about the VM and what the probe
 * says about the tenant.
 *
 * A booted microVM is not a running app. `starting` is a VM whose tenant process has not yet
 * accepted a connection and `running` is one that has, and collapsing the two would let a
 * deploy swap traffic onto a booted-but-dead VM — worse than a deploy that fails.
 *
 * A VM that exited without being asked to is `failed`, never restarted here: the guest owns
 * the tenant process's restart budget, and when it exhausts it the guest powers itself off.
 * Rebooting the VM at that point would hide a broken deploy behind a host that retries forever,
 * and deciding whether to try elsewhere is the reconciler's call.
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
  const withinGrace = startedAtMs === undefined || nowMs - startedAtMs < healthCheck.gracePeriodMs;
  if (tracker.consecutiveFailures >= healthCheck.unhealthyThreshold && !withinGrace) {
    return tracker.everHealthy ? 'unhealthy' : 'failed';
  }
  return tracker.everHealthy ? 'running' : 'starting';
}
