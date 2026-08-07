import { Duration, Effect, Schedule } from 'effect';
import { supervised } from '#lib/agent/loop.ts';
import { STARTUP_PROBE_INTERVAL_MS } from '#lib/health/state.ts';
import type { InstanceRecord } from '#lib/report/instance-record.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { Reconciler } from '#services/reconciler.service.ts';

const TICK = Duration.seconds(1);
/** A probe cannot land sooner than the tick that runs it, so coming up is worth ticking for. */
const SETTLING_TICK = Duration.millis(STARTUP_PROBE_INTERVAL_MS);

function settling(record: InstanceRecord): boolean {
  return record.state === 'pending' || record.state === 'starting';
}

const untilNextRefresh = Effect.flatMap(AgentState.records, (records) =>
  Effect.sleep(records.some(settling) ? SETTLING_TICK : TICK),
);

export const statusLoop = Effect.gen(function* () {
  const reconciler = yield* Reconciler;
  yield* supervised({
    once: Effect.andThen(reconciler.refresh, untilNextRefresh),
    onFailure: (cause) => Effect.logWarning('status refresh failed', cause),
    schedule: Schedule.spaced(TICK),
  });
});
