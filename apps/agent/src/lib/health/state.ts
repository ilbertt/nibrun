import type { HealthCheck, HttpPort, InstanceState, Timestamp } from '@repo/protocol';
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

export type GraceInputs = {
  healthCheck: HealthCheck;
  startedAtMs?: number;
  nowMs: number;
};

type ProbeInputs = GraceInputs & { tracker: HealthTracker };

/** An instance with no start time has not been booted by this agent, so nothing has run out yet. */
export function isWithinGracePeriod({ healthCheck, startedAtMs, nowMs }: GraceInputs): boolean {
  return startedAtMs === undefined || nowMs - startedAtMs < healthCheck.gracePeriodMs;
}

/**
 * Whether this tenant is still being given its first chance to answer.
 *
 * Bounded by the grace period rather than by the state alone, which is what keeps it — and the
 * loop that ticks for it — from running for as long as an app that never settles is up.
 */
export function isOnStartupGrid({ tracker, ...grace }: ProbeInputs): boolean {
  return !tracker.everHealthy && isWithinGracePeriod(grace);
}

/**
 * The fast grid applies only while a tenant is still owed its grace period, so a slow starter
 * is failed on exactly the schedule it was before: `unhealthyThreshold` probes at `intervalMs`
 * after the grace runs out.
 */
export function nextProbeDelayMs(inputs: ProbeInputs): number {
  return isOnStartupGrid(inputs)
    ? Math.min(STARTUP_PROBE_INTERVAL_MS, inputs.healthCheck.intervalMs)
    : inputs.healthCheck.intervalMs;
}

/**
 * Why a `failed` verdict was reached, for the owner who only ever sees the verdict.
 *
 * There are two ways to reach it and one fact tells them apart: an instance either stopped when
 * nothing had asked it to, or was still up and never answered. Reading that off the unit is what
 * keeps this from being a second copy of the branches below, drifting out of step with them.
 *
 * A guest that stopped has usually said why on its console, and that account wins: the exit code
 * beside it is the one *Firecracker* ended with, which is 0 whenever the guest powered itself off
 * deliberately — so on the failure the owner is most likely to hit, it reads as success.
 */
export function describeInstanceFailure({
  unit,
  tracker,
  healthCheck,
  httpPort,
  guestVerdict,
}: {
  unit: UnitStatus;
  tracker: HealthTracker;
  healthCheck: HealthCheck;
  httpPort: HttpPort;
  guestVerdict?: string;
}): string {
  if (!unit.active) {
    if (guestVerdict !== undefined) {
      return guestVerdict;
    }
    return unit.exitCode === undefined
      ? 'the microVM stopped without being asked to'
      : `the microVM stopped without being asked to, exit code ${unit.exitCode}`;
  }
  return `nothing answered on port ${httpPort} inside the guest: ${tracker.consecutiveFailures} health probes failed after the ${healthCheck.gracePeriodMs}ms grace period`;
}

export type LifecycleInputs = {
  unit: UnitStatus;
  tracker: HealthTracker;
  healthCheck: HealthCheck;
  desiredRunning: boolean;
  onRequest: boolean;
  stopRequested: boolean;
  snapshotting: boolean;
  startedAtMs?: number;
  nowMs: number;
  /**
   * What the record already says, which is the only thing that tells a start in flight from an
   * app waiting to be asked for: both are `on-request` instances with no microVM behind them yet,
   * and the planner has already decided which by writing `pending` or `idle`.
   */
  current: InstanceState;
};

/**
 * What a microVM that is not up means, which is four different things.
 *
 * `stopped` and `idle` are the same absence read against who is waiting: one is the end of the
 * release, the other is the release between requests. `pending` is a start still in flight, and
 * only a start this agent saw through records a time — systemd keeps a template instance loaded
 * after it stops, so being loaded is not having been started.
 *
 * A boot that did happen rules out `idle` whatever the activation policy says: a microVM a
 * request brought up and that then went down unasked is a crash, and calling that idle would
 * wait for another request to find out.
 *
 * Unasked is the whole of it, and a snapshot in flight is the one absence that is asked for
 * without `stopRequested` saying so: the capture ends with the VMM gone and the flag is only
 * written once it has finished, so a pass landing in between would read a sleep as that crash.
 */
function evaluateStoppedState({
  desiredRunning,
  onRequest,
  stopRequested,
  snapshotting,
  startedAtMs,
  current,
}: Pick<
  LifecycleInputs,
  'desiredRunning' | 'onRequest' | 'stopRequested' | 'snapshotting' | 'startedAtMs' | 'current'
>): InstanceState {
  const down = onRequest && desiredRunning ? 'idle' : 'stopped';
  if (stopRequested || snapshotting || !desiredRunning) {
    return down;
  }
  if (startedAtMs !== undefined) {
    return 'failed';
  }
  // A start this agent asked for and has not seen through is not an app waiting to be asked for.
  // `startInstance` writes `pending` before a boot that has an artifact to fetch, `sleepInstance`
  // writes `idle`, and until the unit is up those two look identical from here. Reading a release
  // that is coming up as `idle` tells the control plane it is as up as it will ever get: the
  // startup deadline stops, the deployment turns `running` before a probe has run, and the memory
  // the boot is about to take is left out of what this host counts as committed.
  return onRequest && current !== 'pending' ? down : 'pending';
}

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
  onRequest,
  stopRequested,
  snapshotting,
  startedAtMs,
  nowMs,
  current,
}: LifecycleInputs): InstanceState {
  if (unit.failed) {
    return 'failed';
  }
  if (!unit.active) {
    return evaluateStoppedState({
      desiredRunning,
      onRequest,
      stopRequested,
      snapshotting,
      startedAtMs,
      current,
    });
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
