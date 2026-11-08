import type {
  AgentSession,
  SecretString,
  SqliteOutcome,
  SqliteQuery,
  SqliteQueryRequest,
} from '@repo/protocol';
import { Duration, Effect, Ref } from 'effect';
import type { ControlPlaneClient, ControlPlaneError } from '#lib/control/client.ts';
import { SqliteSessionUnavailable, sqliteFailure } from '#lib/sqlite/sessions.ts';
import type { SqliteSessions } from '#services/sqlite-sessions.service.ts';

const IDLE_POLL_FLOOR: Duration.DurationInput = '5 seconds';
export const MAX_ACTIVE_SQLITE_QUERIES = 64;
const BUSY: SqliteOutcome = {
  status: 'failed',
  code: 'SQLITE_BUSY',
  message: 'The host has no available SQLite query worker.',
};
const CLOSED = sqliteFailure(new SqliteSessionUnavailable());

export function makeSqliteQueryPoll<E, R>({
  control,
  currentSession,
  servedDeployments,
  onExpired,
  sessions,
}: {
  control: ControlPlaneClient;
  currentSession: Effect.Effect<AgentSession, E, R>;
  servedDeployments: Effect.Effect<SqliteQueryRequest['servedDeployments'], E, R>;
  onExpired: (error: ControlPlaneError) => Effect.Effect<void>;
  sessions: Pick<SqliteSessions, 'request'>;
}) {
  return Effect.gen(function* () {
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
      }).pipe(Effect.tapErrorTag('ControlPlaneError', onExpired));
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
          return yield* control
            .sendSqliteQueryResult({
              sessionToken,
              result: { queryId: query.queryId, outcome: BUSY },
            })
            .pipe(Effect.tapError(onExpired));
        }
        yield* answer({ query, sessionToken }).pipe(
          Effect.catchAllCause(() => Effect.logWarning('SQLite query result could not be sent')),
          Effect.ensuring(Ref.update(active, (count) => count - 1)),
          Effect.forkScoped,
        );
      });
    }

    return Effect.gen(function* () {
      const session = yield* currentSession;
      const [held, response] = yield* Effect.timed(
        control
          .fetchSqliteQuery({
            sessionToken: session.sessionToken,
            request: {
              servedDeployments: yield* servedDeployments,
            },
          })
          .pipe(Effect.tapErrorTag('ControlPlaneError', onExpired)),
      );
      if (response.result === 'none') {
        return yield* Effect.sleep(Duration.subtract(IDLE_POLL_FLOOR, held));
      }
      yield* dispatch({ query: response.query, sessionToken: session.sessionToken });
    });
  });
}
