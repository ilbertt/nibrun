import type { HostDesiredState } from '@repo/protocol';
import { Duration, Effect, Option } from 'effect';
import { CONTROL_PLANE_BACKOFF } from '#agent/backoff.ts';
import { supervised } from '#agent/loop.ts';
import type { ProtocolMismatch } from '#lib/protocol.ts';
import * as State from '#reconcile/state.ts';
import { AgentSessionHolder } from '#services/agent-session-holder.service.ts';
import { ControlPlane } from '#services/control-plane.service.ts';
import { DesiredStateCache } from '#services/desired-state-cache.service.ts';
import { Reconciler } from '#services/reconciler.service.ts';

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

/** A rejected message is the control plane's bug, not a flaky link, so it is not a warning. */
const logRejectedState = (error: ProtocolMismatch) =>
  Effect.logError('desired state rejected by validation').pipe(
    Effect.annotateLogs({ issues: error.issues }),
  );

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

  yield* supervised({
    once: once.pipe(
      Effect.tapErrorTag('ControlPlaneError', sessions.onExpired),
      Effect.tapErrorTag('ProtocolMismatch', logRejectedState),
    ),
    onFailure: (cause) => Effect.logWarning('desired state poll failed', cause),
    schedule: CONTROL_PLANE_BACKOFF,
  });
});
