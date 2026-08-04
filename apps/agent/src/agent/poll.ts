import { type HostDesiredState, ProtocolValidationError } from '@repo/protocol';
import { Duration, Effect, Option } from 'effect';
import { CONTROL_PLANE_BACKOFF } from '#agent/backoff.ts';
import { DesiredStateCache } from '#agent/desired-state.ts';
import { AgentSessionHolder } from '#agent/session.ts';
import { ControlPlane } from '#control/client.ts';
import { Reconciler } from '#reconcile/reconciler.ts';
import * as State from '#reconcile/state.ts';

export const reconcileSafely = (desired: HostDesiredState) =>
  Effect.gen(function* () {
    const reconciler = yield* Reconciler;
    yield* reconciler
      .reconcile(desired)
      .pipe(
        Effect.catchAllCause((cause) =>
          Effect.logError('reconcile failed', cause).pipe(
            Effect.annotateLogs({ generation: desired.generation }),
          ),
        ),
      );
  });

const logPollFailure = (error: unknown) =>
  error instanceof ProtocolValidationError
    ? Effect.logError('desired state rejected by validation').pipe(
        Effect.annotateLogs({ issues: error.issues }),
      )
    : Effect.logWarning('desired state poll failed', error);

export const pollLoop = Effect.gen(function* () {
  const control = yield* ControlPlane;
  const sessions = yield* AgentSessionHolder;
  const cache = yield* DesiredStateCache;

  const once = Effect.gen(function* () {
    const session = yield* sessions.current;
    const response = yield* control.fetchDesiredState({
      sessionToken: session.sessionToken,
      request: { knownGeneration: yield* cache.knownGeneration },
    });

    if (response.result === 'changed') {
      yield* cache.accept(response.state);
      yield* reconcileSafely(response.state);
    } else {
      // Only a new generation re-runs a reconcile, and work the last one deferred does not change
      // it — so a volume waiting on an instance to stop would otherwise never be carried.
      const latest = yield* cache.latest;
      if ((yield* State.snapshot).deferredWork && Option.isSome(latest)) {
        yield* reconcileSafely(latest.value);
      }
    }
    yield* Effect.sleep(Duration.millis(session.poll.minIntervalMs));
  });

  yield* once.pipe(
    Effect.tapError((error) =>
      sessions.forgetIfExpired(error).pipe(Effect.andThen(logPollFailure(error))),
    ),
    Effect.retry(CONTROL_PLANE_BACKOFF),
    Effect.forever,
  );
});
