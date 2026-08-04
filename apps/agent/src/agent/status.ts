import { Duration, Effect, Schedule } from 'effect';
import { supervised } from '#agent/loop.ts';
import { Reconciler } from '#reconcile/reconciler.ts';

const TICK = Duration.seconds(1);

export const statusLoop = Effect.gen(function* () {
  const reconciler = yield* Reconciler;
  yield* supervised({
    once: Effect.andThen(reconciler.refresh, Effect.sleep(TICK)),
    onFailure: (cause) => Effect.logWarning('status refresh failed', cause),
    schedule: Schedule.spaced(TICK),
  });
});
