import { Duration, Effect } from 'effect';
import { Reconciler } from '#reconcile/reconciler.ts';

const TICK = Duration.seconds(1);

export const statusLoop = Effect.gen(function* () {
  const reconciler = yield* Reconciler;
  yield* reconciler.refresh.pipe(
    Effect.catchAllCause((cause) => Effect.logWarning('status refresh failed', cause)),
    Effect.andThen(Effect.sleep(TICK)),
    Effect.forever,
  );
});
