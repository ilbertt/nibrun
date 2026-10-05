import { Socket } from '@effect/platform';
import { BunSocket } from '@effect/platform-bun';
import type { SqliteOperation } from '@repo/protocol';
import { Cause, Deferred, Duration, Effect, Exit, Fiber, Option } from 'effect';
import { GuestSqliteFailed, MalformedSqliteReply, SqliteDisconnected } from '#lib/sqlite/errors.ts';
import { encodeSqliteRequest, GUEST_SQLITE_VSOCK_PORT } from '#lib/sqlite/protocol.ts';
import { type SqliteWireError, sqliteWireSession } from '#lib/sqlite/session.ts';
import { connectRequest } from '#lib/vm/vsock.ts';

const RESPONSE_TIMEOUT = Duration.seconds(10);

function readerFailure(exit: Exit.Exit<void, SqliteWireError>) {
  const failure = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none();
  return Option.isSome(failure) ? failure.value : new SqliteDisconnected();
}

export function connectGuestSqlite({ socketPath }: { socketPath: string }) {
  return Effect.gen(function* () {
    const session = yield* sqliteWireSession;
    const opened = yield* Deferred.make<void, SqliteWireError>();
    const stopped = yield* Deferred.make<void>();
    const socket = yield* BunSocket.makeNet({
      path: socketPath,
      openTimeout: RESPONSE_TIMEOUT,
    }).pipe(Effect.mapError(() => new SqliteDisconnected()));
    const write = yield* socket.writer;
    const serial = yield* Effect.makeSemaphore(1);

    function sending(bytes: string | Uint8Array) {
      return write(bytes).pipe(Effect.mapError(() => new SqliteDisconnected()));
    }

    const reader = yield* socket
      .run(session.receive, { onOpen: Effect.asVoid(Deferred.succeed(opened, undefined)) })
      .pipe(
        Effect.catchTag('SocketError', () => Effect.fail(new SqliteDisconnected())),
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            const error = readerFailure(exit);
            yield* Deferred.fail(opened, error);
            yield* session.close(error);
            yield* Deferred.succeed(stopped, undefined);
          }),
        ),
        Effect.forkScoped,
      );

    function deadline<A, E, R>(effect: Effect.Effect<A, E, R>) {
      return effect.pipe(
        Effect.timeoutFail({
          duration: RESPONSE_TIMEOUT,
          onTimeout: () => new SqliteDisconnected(),
        }),
        Effect.onError(() => Effect.asVoid(Fiber.interrupt(reader))),
        Effect.onInterrupt(() => Effect.asVoid(Fiber.interrupt(reader))),
      );
    }

    yield* deadline(
      Effect.gen(function* () {
        yield* Deferred.await(opened);
        yield* sending(connectRequest(GUEST_SQLITE_VSOCK_PORT));
        if ((yield* session.awaitEvent).kind !== 'connected') {
          return yield* new MalformedSqliteReply();
        }
      }),
    );

    function request(operation: SqliteOperation) {
      return serial.withPermits(1)(
        deadline(
          Effect.gen(function* () {
            const bytes = yield* encodeSqliteRequest(operation);
            yield* session.next;
            yield* sending(bytes);
            const reply = yield* session.awaitEvent;
            if (reply.kind === 'connected') {
              return yield* new MalformedSqliteReply();
            }
            return reply;
          }),
        ).pipe(
          Effect.flatMap((reply) =>
            reply.kind === 'error'
              ? Effect.fail(new GuestSqliteFailed({ code: reply.code, reason: reply.message }))
              : Effect.succeed(reply),
          ),
        ),
      );
    }

    const close = write(new Socket.CloseEvent()).pipe(
      Effect.catchAll(() => Effect.void),
      Effect.raceFirst(Deferred.await(stopped)),
      Effect.ensuring(Fiber.interrupt(reader)),
      Effect.asVoid,
    );
    return { request, close };
  });
}
