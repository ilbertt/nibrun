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
 * The same tracker with this microVM's own run of probes cleared and the app's history kept.
 *
 * `everHealthy` is a fact about the app — whether it has ever served — and survives, because it is
 * what later decides whether a run of failures reads as `unhealthy` or as an app that never served
 * at all. The run of successes is a fact about the microVM in front of it, and one restored from a
 * snapshot has answered nothing yet however long the app it belongs to has been up.
 */
export function afterRestore(tracker: HealthTracker): HealthTracker {
  return { ...tracker, consecutiveSuccesses: NO_PROBES, consecutiveFailures: NO_PROBES };
}

/**
 * Whether this microVM is still being given its first chance to answer.
 *
 * A restore is the second way to be owed one, and reading `everHealthy` alone misses it: a woken
 * app has served plenty and the guest in front of it has answered nothing, so the boot the fast
 * grid was written for is the one boot it would not have covered — leaving the request that woke
 * the app waiting out a tick measured for apps that are already up.
 *
 * Bounded by the grace period rather than by the tracker alone, which is what keeps it — and the
 * loop that ticks for it — from running for as long as an app that never settles is up.
 */
export function isOnStartupGrid({ tracker, ...grace }: ProbeInputs): boolean {
  const hasAnswered = tracker.everHealthy && tracker.consecutiveSuccesses > NO_PROBES;
  return !hasAnswered && isWithinGracePeriod(grace);
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
  startedAtMs?: number;
  nowMs: number;
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
 */
function evaluateStoppedState({
  desiredRunning,
  onRequest,
  stopRequested,
  startedAtMs,
}: Pick<
  LifecycleInputs,
  'desiredRunning' | 'onRequest' | 'stopRequested' | 'startedAtMs'
>): InstanceState {
  const down = onRequest && desiredRunning ? 'idle' : 'stopped';
  if (stopRequested || !desiredRunning) {
    return down;
  }
  if (startedAtMs !== undefined) {
    return 'failed';
  }
  return onRequest ? down : 'pending';
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
  startedAtMs,
  nowMs,
}: LifecycleInputs): InstanceState {
  if (unit.failed) {
    return 'failed';
  }
  if (!unit.active) {
    return evaluateStoppedState({ desiredRunning, onRequest, stopRequested, startedAtMs });
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
