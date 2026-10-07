import type { SecretString, SqliteOutcome, SqliteQuery } from '@repo/protocol';
import { Duration, Effect, Option, Ref } from 'effect';
import { CONTROL_PLANE_BACKOFF } from '#lib/agent/backoff.ts';
import { supervised } from '#lib/agent/loop.ts';
import { SqliteSessionUnavailable, sqliteFailure } from '#lib/sqlite/sessions.ts';
import { AgentSessionHolder } from '#services/agent-session-holder.service.ts';
import { ControlPlane } from '#services/control-plane.service.ts';
import { DesiredStateCache } from '#services/desired-state-cache.service.ts';
import { SqliteSessions } from '#services/sqlite-sessions.service.ts';

const IDLE_POLL_FLOOR: Duration.DurationInput = '5 seconds';
export const MAX_ACTIVE_SQLITE_QUERIES = 64;
const BUSY: SqliteOutcome = {
  status: 'failed',
  code: 'SQLITE_BUSY',
  message: 'The host has no available SQLite query worker.',
};
const CLOSED = sqliteFailure(new SqliteSessionUnavailable());

export const sqliteQueryLoop = Effect.gen(function* () {
  const control = yield* ControlPlane;
  const holder = yield* AgentSessionHolder;
  const cache = yield* DesiredStateCache;
  const sessions = yield* SqliteSessions;
  const active = yield* Ref.make(0);

  function answer({ query, sessionToken }: { query: SqliteQuery; sessionToken: SecretString }) {
    return Effect.gen(function* () {
      const outcome = yield* sessions
        .request(query)
        .pipe(Effect.catchAllCause(() => Effect.succeed(CLOSED)));
      yield* control.sendSqliteQueryResult({
        sessionToken,
        result: { queryId: query.queryId, outcome },
      });
    }).pipe(Effect.tapErrorTag('ControlPlaneError', holder.onExpired));
  }

  function dispatch({ query, sessionToken }: { query: SqliteQuery; sessionToken: SecretString }) {
    return Effect.gen(function* () {
      if (query.operation.type === 'close') {
        return yield* answer({ query, sessionToken });
      }
      const admitted = yield* Ref.modify(active, (count) =>
        count < MAX_ACTIVE_SQLITE_QUERIES ? [true, count + 1] : [false, count],
      );
      if (!admitted) {
        return yield* control.sendSqliteQueryResult({
          sessionToken,
          result: { queryId: query.queryId, outcome: BUSY },
        });
      }
      yield* answer({ query, sessionToken }).pipe(
        Effect.catchAllCause(() => Effect.logWarning('SQLite query result could not be sent')),
        Effect.ensuring(Ref.update(active, (count) => count - 1)),
        Effect.forkScoped,
      );
    });
  }

  const poll = Effect.gen(function* () {
    const session = yield* holder.current;
    const desired = Option.getOrUndefined(yield* cache.latest);
    const [held, response] = yield* Effect.timed(
      control.fetchSqliteQuery({
        sessionToken: session.sessionToken,
        request: {
          servedDeployments:
            desired?.instances.map(({ appId, deploymentId }) => ({ appId, deploymentId })) ?? [],
        },
      }),
    );
    if (response.result === 'none') {
      return yield* Effect.sleep(Duration.subtract(IDLE_POLL_FLOOR, held));
    }
    yield* dispatch({ query: response.query, sessionToken: session.sessionToken });
  });

  yield* supervised({
    once: Effect.tapErrorTag(poll, 'ControlPlaneError', holder.onExpired),
    onFailure: () => Effect.logWarning('SQLite query poll failed'),
    schedule: CONTROL_PLANE_BACKOFF,
  });
}).pipe(Effect.scoped);
