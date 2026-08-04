import { Cause, Clock, Data, Deferred, type Duration, Effect, Schedule, Stream } from 'effect';
import { CONTROL_PLANE_BACKOFF } from '#agent/backoff.ts';
import { supervised } from '#agent/loop.ts';
import { AgentSessionHolder } from '#agent/session.ts';
import { ControlPlane } from '#control/client.ts';
import { TenantLogQueue } from '#logs/queue.ts';

/**
 * How long one upload lasts before the agent closes it and opens the next. The agent ends it
 * rather than the control plane because only the sender knows when nothing is in flight; ended at
 * a drained queue it costs nothing, and short is what keeps a stalled upload from holding a
 * host's output hostage.
 */
const WINDOW: Duration.DurationInput = '30 seconds';

/** Silence, not the window, is what an idle timer measures, and a quiet app produces plenty. */
const KEEPALIVE_INTERVAL: Duration.DurationInput = '10 seconds';

/**
 * The agent ends each upload itself, so a stream that ended well inside its own window ended for
 * a reason nobody chose. Counting that as a failure keeps a misconfigured edge from becoming a
 * silent reconnect loop.
 */
const MIN_HEALTHY_MS = 5_000;

class LogStreamEndedEarly extends Data.TaggedError('LogStreamEndedEarly')<{
  readonly elapsedMs: number;
}> {}

const uploadWindow = Effect.gen(function* () {
  const control = yield* ControlPlane;
  const sessions = yield* AgentSessionHolder;
  const logs = yield* TenantLogQueue;

  const ending = yield* Deferred.make<void>();
  const body = yield* Stream.toReadableStreamEffect(logs.body(ending));
  const session = yield* sessions.current;
  const startedAtMs = yield* Clock.currentTimeMillis;

  yield* Effect.scoped(
    Effect.gen(function* () {
      yield* Effect.forkScoped(Effect.repeat(logs.keepalive, Schedule.spaced(KEEPALIVE_INTERVAL)));
      yield* Effect.forkScoped(
        Effect.andThen(Effect.sleep(WINDOW), Deferred.succeed(ending, undefined)),
      );
      yield* control.streamTenantLogs({ sessionToken: session.sessionToken, body });
    }),
  ).pipe(
    // A control plane that answers before the body ends leaves this stream still pulling, and a
    // chunk handed to it would be delivered nowhere.
    Effect.ensuring(Effect.ignore(Effect.tryPromise(() => body.cancel()))),
  );

  const elapsedMs = (yield* Clock.currentTimeMillis) - startedAtMs;
  if (elapsedMs < MIN_HEALTHY_MS) {
    return yield* new LogStreamEndedEarly({ elapsedMs });
  }
});

export const logLoop = Effect.gen(function* () {
  const sessions = yield* AgentSessionHolder;
  // Reaching the end of a window is not a failure, so the next upload opens immediately.
  yield* supervised({
    once: uploadWindow,
    onFailure: (cause) =>
      sessions
        .forgetIfExpired(Cause.squash(cause))
        .pipe(Effect.andThen(Effect.logWarning('tenant log stream failed', cause))),
    schedule: CONTROL_PLANE_BACKOFF,
  });
});
