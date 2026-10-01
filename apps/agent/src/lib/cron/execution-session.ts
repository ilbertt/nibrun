import { Buffer } from 'node:buffer';
import { Data, Deferred, Effect, Option, Ref } from 'effect';
import {
  type CronExecutionReply,
  decodeCronConnect,
  decodeCronExecution,
  MalformedCronExecutionReply,
} from '#lib/cron/execution-protocol.ts';

export class CronExecutionDisconnected extends Data.TaggedError('CronExecutionDisconnected') {
  override get message() {
    return 'The guest connection closed before cron execution completed.';
  }
}

export type CronWireError = MalformedCronExecutionReply | CronExecutionDisconnected;
type SessionEvent = CronExecutionReply | { readonly kind: 'connected' };
type SessionState = {
  readonly phase: 'connect' | 'execution';
  readonly buffered: Buffer;
  readonly pending: Deferred.Deferred<SessionEvent, CronWireError>;
  readonly delivered: boolean;
  readonly closed: CronWireError | undefined;
};

function decodeIncoming({ state, chunk }: { state: SessionState; chunk: Uint8Array }) {
  return Effect.gen(function* () {
    if (state.closed !== undefined || state.delivered) {
      return yield* new MalformedCronExecutionReply();
    }
    if (state.phase === 'connect') {
      const decoded = yield* decodeCronConnect({ buffered: state.buffered, chunk });
      return {
        buffered: decoded.buffered,
        event: decoded.connected
          ? Option.some<SessionEvent>({ kind: 'connected' })
          : Option.none<SessionEvent>(),
      };
    }
    const decoded = yield* decodeCronExecution({ buffered: state.buffered, chunk });
    return { buffered: decoded.buffered, event: decoded.reply };
  });
}

export const cronExecutionSession = Effect.gen(function* () {
  const state = yield* Ref.make<SessionState>({
    phase: 'connect',
    buffered: Buffer.alloc(0),
    pending: yield* Deferred.make<SessionEvent, CronWireError>(),
    delivered: false,
    closed: undefined,
  });
  const serial = yield* Effect.makeSemaphore(1);

  function receive(chunk: Uint8Array) {
    return serial.withPermits(1)(
      Effect.gen(function* () {
        const before = yield* Ref.get(state);
        const decoded = yield* decodeIncoming({ state: before, chunk });
        yield* Ref.set(state, {
          ...before,
          buffered: decoded.buffered,
          delivered: Option.isSome(decoded.event),
        });
        if (Option.isSome(decoded.event)) {
          yield* Deferred.succeed(before.pending, decoded.event.value);
        }
      }),
    );
  }

  function close(error: CronWireError) {
    return serial.withPermits(1)(
      Effect.gen(function* () {
        const before = yield* Ref.get(state);
        yield* Ref.set(state, { ...before, closed: error });
        yield* Deferred.fail(before.pending, error);
      }),
    );
  }

  const next = Effect.gen(function* () {
    const before = yield* Ref.get(state);
    if (before.closed !== undefined) {
      return yield* before.closed;
    }
    yield* Ref.set(state, {
      ...before,
      phase: 'execution',
      buffered: Buffer.alloc(0),
      pending: yield* Deferred.make<SessionEvent, CronWireError>(),
      delivered: false,
    });
  });

  const awaitEvent = Effect.flatMap(Ref.get(state), (current) => Deferred.await(current.pending));
  return { receive, close, next: serial.withPermits(1)(next), awaitEvent };
});
