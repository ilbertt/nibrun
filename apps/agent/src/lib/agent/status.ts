import { Clock, Duration, Effect, Schedule } from 'effect';
import { supervised } from '#lib/agent/loop.ts';
import { isOnStartupGrid, STARTUP_PROBE_INTERVAL_MS } from '#lib/health/state.ts';
import { graceInputs } from '#lib/report/instance-record.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { Reconciler } from '#services/reconciler.service.ts';
import { RefreshSignal } from '#services/refresh-signal.service.ts';

const TICK = Duration.seconds(1);
/** A probe cannot land sooner than the tick that runs it, so the two share one cadence. */
const SETTLING_TICK = Duration.millis(STARTUP_PROBE_INTERVAL_MS);

/**
 * The floor a raise cannot get under, for the reason MIN_REPORT_GAP has one.
 *
 * A refresh probes every instance that is due, renders the ruleset and writes the host's state to
 * disk, and that last part is not deduplicated the way the ruleset and the routes are. Left
 * ungated, a host waking apps steadily would run it as fast as the disk allows — and a host with
 * enough on-request apps to be waking them steadily is the one this whole feature is for.
 */
const MIN_REFRESH_GAP: Duration.DurationInput = '250 millis';

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
  // Raced rather than slept, because the length is chosen from the state as it stands now: a
  // microVM that comes up during it is one this decision could not have known about, and the app
  // is reached through the activator rather than through its forward rule until the refresh that
  // renders one. The signal is what makes that wait as long as the wake and no longer.
  yield* Effect.race(
    Effect.sleep(settling ? SETTLING_TICK : TICK),
    Effect.andThen(Effect.sleep(MIN_REFRESH_GAP), RefreshSignal.awaited),
  );
});

export const statusLoop = Effect.gen(function* () {
  const reconciler = yield* Reconciler;
  yield* supervised({
    once: Effect.andThen(reconciler.refresh, untilNextRefresh),
    onFailure: (cause) => Effect.logWarning('status refresh failed', cause),
    schedule: Schedule.spaced(TICK),
  });
});
