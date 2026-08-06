import type { FilesystemQuery, FilesystemQueryResult } from '@repo/protocol';
import { type Duration, Effect } from 'effect';
import { CONTROL_PLANE_BACKOFF } from '#lib/agent/backoff.ts';
import { supervised } from '#lib/agent/loop.ts';
import { reportedMessage } from '#lib/failure.ts';
import { AgentSessionHolder } from '#services/agent-session-holder.service.ts';
import { ControlPlane } from '#services/control-plane.service.ts';
import { FilesystemReader } from '#services/filesystem-reader.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';

/**
 * Slept only when there was nothing to read, so this is how long an idle host waits rather than
 * how long a browsing caller does: every query has somebody holding a request open for it, and
 * pausing between two of them would charge that person for a host that had nothing else to do.
 *
 * Reading back to back cannot run away, because a query exists only while its caller waits —
 * demand is what bounds the rate, and demand stops when people stop asking.
 */
const IDLE_POLL_INTERVAL: Duration.DurationInput = '5 seconds';

/**
 * A read this host can serve is one it has a device for, which is what the slot table records.
 * Sent on every poll rather than registered once: a volume torn down between two polls stops
 * being offered on the next one, with nothing to invalidate.
 */
const servedAppIds = Effect.map(
  Effect.flatMap(SlotAllocator, (allocator) => allocator.slots),
  (slots) => slots.map((slot) => slot.appId),
);

/**
 * Answered whatever happens, because the failure is the answer as far as the caller is concerned.
 * A host that stays quiet about a device it could not read turns a refusal somebody could act on
 * into a timeout they cannot.
 */
export const answer = (query: FilesystemQuery) =>
  Effect.gen(function* () {
    const reader = yield* FilesystemReader;
    return yield* reader.list({ appId: query.appId, path: query.path }).pipe(
      Effect.map(
        (listing) =>
          ({
            queryId: query.queryId,
            outcome: { status: 'listed', listing },
          }) satisfies FilesystemQueryResult,
      ),
      Effect.catchAll((error) =>
        Effect.logWarning('filesystem read failed', error).pipe(
          Effect.annotateLogs({ queryId: query.queryId, appId: query.appId }),
          Effect.as({
            queryId: query.queryId,
            outcome: { status: 'failed', message: reportedMessage(error) },
          } satisfies FilesystemQueryResult),
        ),
      ),
    );
  });

const once = Effect.gen(function* () {
  const control = yield* ControlPlane;
  const sessions = yield* AgentSessionHolder;
  const session = yield* sessions.current;

  const response = yield* control.fetchFilesystemQuery({
    sessionToken: session.sessionToken,
    request: { servedAppIds: yield* servedAppIds },
  });

  if (response.result === 'none') {
    return yield* Effect.sleep(IDLE_POLL_INTERVAL);
  }

  yield* control.sendFilesystemQueryResult({
    sessionToken: session.sessionToken,
    result: yield* answer(response.query),
  });
});

/**
 * The fifth loop, and deliberately not part of the reconcile: a read observes the host without
 * changing it, so a slow device delays the person waiting on it and nothing else. A backlog of
 * reads must never be able to hold up a stop.
 */
export const filesystemLoop = Effect.gen(function* () {
  const sessions = yield* AgentSessionHolder;
  // An idle tick is not a failure, so a host nobody is browsing never backs off.
  yield* supervised({
    once: Effect.tapErrorTag(once, 'ControlPlaneError', sessions.onExpired),
    onFailure: (cause) => Effect.logWarning('filesystem query loop failed', cause),
    schedule: CONTROL_PLANE_BACKOFF,
  });
});
