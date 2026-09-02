import type { HostDesiredState } from '@repo/protocol';
import { Duration, Effect, Option } from 'effect';
import { CONTROL_PLANE_BACKOFF } from '#lib/agent/backoff.ts';
import { supervised } from '#lib/agent/loop.ts';
import type { ProtocolMismatch } from '#lib/protocol.ts';
import { AgentSessionHolder } from '#services/agent-session-holder.service.ts';
import { AgentState } from '#services/agent-state.service.ts';
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
            Effect.annotateLogs({ hostId: desired.hostId }),
          ),
        ),
      );
  });

/** A rejected message is the control plane's bug, not a flaky link, so it is not a warning. */
const logRejectedState = (error: ProtocolMismatch) =>
  Effect.logError('desired state rejected by validation').pipe(
    Effect.annotateLogs({ issues: error.issues }),
  );

/**
 * How long the control plane is asked to hold a poll that has nothing to answer.
 *
 * The api holds for less where its own ceiling is lower, so this is a request rather than an
 * arrangement — which is what lets the two sides be deployed in either order. What it buys is the
 * whole of `minIntervalMs`: a change landing while this is held is answered in the instant it
 * lands, where before it waited out whatever was left of the interval.
 */
const HOLD_SECONDS = 25;

export const pollLoop = Effect.gen(function* () {
  const control = yield* ControlPlane;
  const sessions = yield* AgentSessionHolder;
  const cache = yield* DesiredStateCache;

  const once = Effect.gen(function* () {
    const session = yield* sessions.current;
    const desired = yield* control.fetchDesiredState({
      sessionToken: session.sessionToken,
      request: { waitSeconds: HOLD_SECONDS },
    });

    if (yield* cache.accept(desired)) {
      yield* reconcileSafely(desired);
    } else {
      // Only desired state moving re-runs a reconcile, and work the last one deferred does not
      // move it — so a volume waiting on an instance to stop would otherwise never be carried.
      const latest = yield* cache.latest;
      if ((yield* AgentState.snapshot).deferredWork && Option.isSome(latest)) {
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
