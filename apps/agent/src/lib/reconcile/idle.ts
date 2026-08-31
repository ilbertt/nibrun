import type { AppId } from '@repo/protocol';
import { Clock, Effect, Option } from 'effect';
import { stopInstance } from '#lib/reconcile/instances.ts';
import { applyNetwork } from '#lib/reconcile/network.ts';
import type { InstanceRecord } from '#lib/report/instance-record.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { DesiredStateCache } from '#services/desired-state-cache.service.ts';

/**
 * What an `on-request` app is given when the control plane names no timeout of its own — an api
 * that predates the field, or one that could not read it. Long enough not to stop an app out
 * from under somebody reading a page, short enough that most of a quiet day is reclaimed.
 */
export const DEFAULT_IDLE_TIMEOUT_MS = 900_000;

/**
 * Only a microVM that is up can be put down, and only one that is not on its way up.
 *
 * `unhealthy` is not among them, though it is up: an app failing its probes has gone quiet
 * *because* it is broken, so the silence is a symptom of the fault rather than evidence nobody
 * wants it. Sleeping it would turn a failure the owner can see into one they cannot, and take it
 * out of the restart and backoff machinery that exists to answer exactly this.
 */
const SLEEPABLE_STATES = new Set(['running']);

/**
 * An app with no activity recorded is never quiet: it is one this agent has not watched long
 * enough to say anything about, and the first counter reading gives it a starting point. Erring
 * towards awake is the only safe direction — the cost is memory, and the cost of the other
 * mistake is somebody's request meeting a microVM being shut down underneath it.
 */
export function hasGoneQuiet({
  record,
  timeoutMs,
  lastActiveAtMs,
  nowMs,
}: {
  record: InstanceRecord;
  timeoutMs: number | undefined;
  lastActiveAtMs: number | undefined;
  nowMs: number;
}): boolean {
  return (
    record.onRequest &&
    record.desiredRunning &&
    SLEEPABLE_STATES.has(record.state) &&
    timeoutMs !== undefined &&
    lastActiveAtMs !== undefined &&
    nowMs - lastActiveAtMs >= timeoutMs
  );
}

/**
 * The timeout is read from desired state rather than from the record, so an owner shortening it
 * takes effect on the next poll rather than on the app's next boot. An app desired state no
 * longer calls `on-request` has no timeout here and is left to the reconciler, which is the one
 * that knows what should happen to it instead.
 */
const idleTimeouts = Effect.gen(function* () {
  const desired = yield* (yield* DesiredStateCache).latest;
  return new Map<AppId, number>(
    Option.getOrUndefined(desired)?.instances.flatMap((instance) =>
      instance.desiredState === 'on-request'
        ? [[instance.appId, instance.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS] as const]
        : [],
    ) ?? [],
  );
});

/**
 * Stops the `on-request` apps nobody has asked for in a while.
 *
 * Runs on the measurement tick rather than the status one: the moment it reads is only written
 * there, so asking sixty times more often would be sixty readings of the same answer — and a stop
 * freezes a filesystem and waits on systemd, which is not work to put in front of the health
 * probes of every other app on the host.
 */
export const applySleep = Effect.gen(function* () {
  const timeouts = yield* idleTimeouts;
  const current = yield* AgentState.snapshot;
  const nowMs = yield* Clock.currentTimeMillis;

  const quiet = [...current.records.values()].filter((record) =>
    hasGoneQuiet({
      record,
      timeoutMs: timeouts.get(record.appId),
      lastActiveAtMs: current.lastActiveAtMs.get(record.appId),
      nowMs,
    }),
  );
  if (quiet.length === 0) {
    return;
  }

  yield* Effect.forEach(
    quiet,
    (record) =>
      Effect.logInfo('app has gone quiet; letting it sleep')
        .pipe(
          Effect.annotateLogs({
            appId: record.appId,
            quietForMs: nowMs - (current.lastActiveAtMs.get(record.appId) ?? nowMs),
          }),
        )
        .pipe(Effect.andThen(stopInstance({ appId: record.appId, reason: 'idle' }))),
    { discard: true },
  );
  // Here rather than on the next status tick: the record already says the app is not running, so
  // until this runs the forward rule points at a guest that has gone, and a request arriving in
  // that second is refused rather than answered by the activator.
  yield* applyNetwork;
});
