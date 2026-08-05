import { type Duration, Effect, Exit } from 'effect';
import { CONTROL_PLANE_BACKOFF } from '#lib/agent/backoff.ts';
import { supervised } from '#lib/agent/loop.ts';
import { AgentSessionHolder } from '#services/agent-session-holder.service.ts';
import { LogStore } from '#services/log-store.service.ts';
import { MAX_BATCH_BYTES, TenantLogQueue } from '#services/tenant-log-queue.service.ts';

/**
 * How long the loop waits when there is nothing to send. Tenant output is read by someone
 * watching a deploy, so this is the floor on how stale what they see can be.
 */
const IDLE_POLL: Duration.DurationInput = '500 millis';

/**
 * One acknowledged batch.
 *
 * A batch is either released or put back, never dropped: `onExit` covers the failure that
 * retries, the defect that does not, and the interruption a shutdown raises — the three ways out
 * of a request that has already taken events out of the queue.
 */
const sendBatch = Effect.gen(function* () {
  const logs = yield* TenantLogQueue;
  const store = yield* LogStore;
  const sessions = yield* AgentSessionHolder;

  if (yield* logs.isEmpty) {
    return yield* Effect.sleep(IDLE_POLL);
  }

  const session = yield* sessions.current;
  const batch = yield* logs.take({ maxBytes: MAX_BATCH_BYTES });

  yield* store.publish({ events: batch, hostId: session.hostId }).pipe(
    Effect.onExit((exit) => (Exit.isSuccess(exit) ? logs.release(batch) : logs.restore(batch))),
    Effect.tapError((error) =>
      Effect.logWarning('tenant log batch failed', error).pipe(
        Effect.annotateLogs({ events: batch.length }),
      ),
    ),
  );
});

export const logLoop = Effect.gen(function* () {
  const sessions = yield* AgentSessionHolder;
  // An idle tick is not a failure, so a quiet host never backs off: the schedule only advances
  // when a batch could not be delivered.
  yield* supervised({
    once: Effect.tapErrorTag(sendBatch, 'ControlPlaneError', sessions.onExpired),
    onFailure: (cause) => Effect.logWarning('tenant log loop failed', cause),
    schedule: CONTROL_PLANE_BACKOFF,
  });
});
