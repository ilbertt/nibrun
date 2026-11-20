import {
  type SqliteOperation,
  type SqliteQuery,
  SqliteQueryIdSchema,
  SqliteSessionIdSchema,
} from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Context, Effect, Layer } from 'effect';
import { SqliteSessionUnavailable } from '#lib/sqlite/sessions.ts';
import { SqliteGuest } from '#services/sqlite-guest.service.ts';
import { SqliteSessions } from '#services/sqlite-sessions.service.ts';
import { APP_ID, DEPLOYMENT_ID, desiredInstance } from '#tests/support/fixtures.ts';
import { connectSqliteClient, servingSqliteGuest } from '#tests/support/guest-sqlite.ts';
import { temporaryDirectory } from '#tests/support/run.ts';

export function sqliteQuery(operation: SqliteOperation): SqliteQuery {
  return {
    queryId: Value.Parse(SqliteQueryIdSchema, crypto.randomUUID()),
    appId: APP_ID,
    deploymentId: DEPLOYMENT_ID,
    sessionId: Value.Parse(SqliteSessionIdSchema, 'sqlite-session-1'),
    operation,
  };
}

export function sqliteHost(responses: readonly Buffer[]) {
  return Effect.gen(function* () {
    const guest = yield* servingSqliteGuest({
      directory: yield* temporaryDirectory,
      responses,
      fragmented: false,
      handshake: 'HTTP/1.1 200 Connection Established\r\n\r\n',
    });
    const services = yield* Layer.build(
      SqliteSessions.Default.pipe(
        Layer.provide(
          Layer.succeed(
            SqliteGuest,
            SqliteGuest.make({
              available: () => Effect.void,
              connect: () =>
                connectSqliteClient({ socketPath: guest.socketPath }).pipe(
                  Effect.mapError(() => new SqliteSessionUnavailable()),
                ),
            }),
          ),
        ),
      ),
    );
    const sessions = Context.get(services, SqliteSessions);
    yield* sessions.syncDeployments({ instances: [desiredInstance()] });
    return { sessions, guest };
  });
}
