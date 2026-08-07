import { Clock, Duration, Effect, Schedule } from 'effect';
import { supervised } from '#lib/agent/loop.ts';
import { isOnStartupGrid, STARTUP_PROBE_INTERVAL_MS } from '#lib/health/state.ts';
import { graceInputs } from '#lib/report/instance-record.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { Reconciler } from '#services/reconciler.service.ts';

const TICK = Duration.seconds(1);
/** A probe cannot land sooner than the tick that runs it, so the two share one cadence. */
const SETTLING_TICK = Duration.millis(STARTUP_PROBE_INTERVAL_MS);

/**
 * Exactly the condition the fast probe grid runs on, rather than the states it tends to appear
 * in: a tick this loop takes for something no longer being probed that fast is one it takes for
 * as long as that instance is up.
 */
const untilNextRefresh = Effect.gen(function* () {
  const records = yield* AgentState.records;
  const nowMs = yield* Clock.currentTimeMillis;
  const settling = records.some((record) =>
    isOnStartupGrid({ tracker: record.health, ...graceInputs({ record, nowMs }) }),
  );
  yield* Effect.sleep(settling ? SETTLING_TICK : TICK);
});

export const statusLoop = Effect.gen(function* () {
  const reconciler = yield* Reconciler;
  yield* supervised({
    once: Effect.andThen(reconciler.refresh, untilNextRefresh),
    onFailure: (cause) => Effect.logWarning('status refresh failed', cause),
    schedule: Schedule.spaced(TICK),
  });
});
