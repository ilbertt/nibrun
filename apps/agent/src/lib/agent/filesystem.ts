import type { FilesystemQuery, FilesystemQueryResult } from '@repo/protocol';
import { Duration, Effect } from 'effect';
import { CONTROL_PLANE_BACKOFF } from '#lib/agent/backoff.ts';
import { supervised } from '#lib/agent/loop.ts';
import { reportedMessage } from '#lib/failure.ts';
import { AgentSessionHolder } from '#services/agent-session-holder.service.ts';
import { ControlPlane } from '#services/control-plane.service.ts';
import { FilesystemReader } from '#services/filesystem-reader.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';

/**
 * A floor under one poll rather than a pause between two, and on the path that matters nothing is
 * left to wait out: the control plane holds an idle request open until a read arrives, so a poll
 * that came back with nothing has already spent longer than this and asks again at once. Every
 * query has somebody holding a request open for it, and pausing before collecting one would charge
 * that person for a host that had nothing else to do.
 *
 * What it is for is an api that answers `none` the instant it is asked, which is what one deployed
 * before the hold does — and one of those stands in front of this agent for the length of every
 * rollout. Without a floor the two would spin against each other as fast as the link allows.
 *
 * Reading back to back still cannot run away: a query exists only while its caller waits, so
 * demand bounds the rate and demand stops when people stop asking.
 */
const IDLE_POLL_FLOOR: Duration.DurationInput = '5 seconds';

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

/** One poll: ask for a read, and either answer it or wait out what is left of the floor. */
export const pollForRead = Effect.gen(function* () {
  const control = yield* ControlPlane;
  const sessions = yield* AgentSessionHolder;
  const session = yield* sessions.current;

  const [held, response] = yield* Effect.timed(
    control.fetchFilesystemQuery({
      sessionToken: session.sessionToken,
      request: { servedAppIds: yield* servedAppIds },
    }),
  );

  if (response.result === 'none') {
    return yield* Effect.sleep(Duration.subtract(IDLE_POLL_FLOOR, held));
  }

  yield* control.sendFilesystemQueryResult({
    sessionToken: session.sessionToken,
    result: yield* answer(response.query),
  });
});

/**
 * The fifth loop, and deliberately not part of the reconcile: a read observes the host without
 * changing it, so a slow device delays the person waiting on it and nothing else. A backlog of
 * reads must never be able to hold up a stop — nor may the request this loop spends most of its
 * life parked on, which interruption abandons rather than waits out.
 */
export const filesystemLoop = Effect.gen(function* () {
  const sessions = yield* AgentSessionHolder;
  // An idle tick is not a failure, so a host nobody is browsing never backs off.
  yield* supervised({
    once: Effect.tapErrorTag(pollForRead, 'ControlPlaneError', sessions.onExpired),
    onFailure: (cause) => Effect.logWarning('filesystem query loop failed', cause),
    schedule: CONTROL_PLANE_BACKOFF,
  });
});
