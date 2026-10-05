import { Buffer } from 'node:buffer';
import { Deferred, Effect, Option, Ref } from 'effect';
import { MalformedSqliteReply, type SqliteDisconnected } from '#lib/sqlite/errors.ts';
import {
  decodeSqliteConnect,
  decodeSqliteReply,
  type SqliteGuestReply,
} from '#lib/sqlite/protocol.ts';

export type SqliteWireError = MalformedSqliteReply | SqliteDisconnected;
type SqliteEvent = SqliteGuestReply | { readonly kind: 'connected' };
type SessionState = {
  readonly phase: 'connect' | 'query';
  readonly buffered: Buffer;
  readonly pending: Deferred.Deferred<SqliteEvent, SqliteWireError>;
  readonly delivered: boolean;
  readonly closed: SqliteWireError | undefined;
};

function decoded({ state, chunk }: { state: SessionState; chunk: Uint8Array }) {
  return Effect.gen(function* () {
    if (state.closed !== undefined || state.delivered) {
      return yield* new MalformedSqliteReply();
    }
    if (state.phase === 'connect') {
      const result = yield* decodeSqliteConnect({ buffered: state.buffered, chunk });
      return {
        buffered: result.buffered,
        event: result.connected
          ? Option.some<SqliteEvent>({ kind: 'connected' })
          : Option.none<SqliteEvent>(),
      };
    }
    const result = yield* decodeSqliteReply({ buffered: state.buffered, chunk });
    return { buffered: result.buffered, event: result.reply };
  });
}

export const sqliteWireSession = Effect.gen(function* () {
  const state = yield* Ref.make<SessionState>({
    phase: 'connect',
    buffered: Buffer.alloc(0),
    pending: yield* Deferred.make<SqliteEvent, SqliteWireError>(),
    delivered: false,
    closed: undefined,
  });
  const serial = yield* Effect.makeSemaphore(1);

  function receive(chunk: Uint8Array) {
    return serial.withPermits(1)(
      Effect.gen(function* () {
        const before = yield* Ref.get(state);
        const result = yield* decoded({ state: before, chunk });
        yield* Ref.set(state, {
          ...before,
          buffered: result.buffered,
          delivered: Option.isSome(result.event),
        });
        if (Option.isSome(result.event)) {
          yield* Deferred.succeed(before.pending, result.event.value);
        }
      }),
    );
  }

  function close(error: SqliteWireError) {
    return serial.withPermits(1)(
      Effect.gen(function* () {
        const before = yield* Ref.get(state);
        yield* Ref.set(state, { ...before, closed: error });
        yield* Deferred.fail(before.pending, error);
      }),
    );
  }

  const next = serial.withPermits(1)(
    Effect.gen(function* () {
      const before = yield* Ref.get(state);
      if (before.closed !== undefined) {
        return yield* before.closed;
      }
      yield* Ref.set(state, {
        ...before,
        phase: 'query',
        buffered: Buffer.alloc(0),
        pending: yield* Deferred.make<SqliteEvent, SqliteWireError>(),
        delivered: false,
      });
    }),
  );
  const awaitEvent = Effect.flatMap(Ref.get(state), (current) => Deferred.await(current.pending));
  return { receive, close, next, awaitEvent };
});
