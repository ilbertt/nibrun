import type { TenantLogEvent } from '@repo/protocol';
import { Deferred, Effect, Option, Queue, Ref, Stream } from 'effect';

const MAX_BUFFERED_BYTES = 8_388_608;
const ENCODER = new TextEncoder();
const NEWLINE = ENCODER.encode('\n');

export class TenantLogQueue extends Effect.Service<TenantLogQueue>()('TenantLogQueue', {
  effect: Effect.gen(function* () {
    const chunks = yield* Queue.unbounded<Uint8Array>();
    const bufferedBytes = yield* Ref.make(0);

    const offer = (chunk: Uint8Array) =>
      Effect.gen(function* () {
        const accepted = yield* Ref.modify(bufferedBytes, (bytes) =>
          bytes + chunk.byteLength > MAX_BUFFERED_BYTES
            ? ([false, bytes] as const)
            : ([true, bytes + chunk.byteLength] as const),
        );
        if (accepted) {
          yield* Queue.offer(chunks, chunk);
        }
        return accepted;
      });

    const taken = (chunk: Uint8Array) =>
      Ref.update(bufferedBytes, (bytes) => bytes - chunk.byteLength);

    /**
     * The body of one upload, which ends at a drained queue and nowhere else: an upload cut
     * mid-flight loses whatever the request had already taken, and HTTP cannot say how much.
     */
    const body = (ending: Deferred.Deferred<void>) =>
      Stream.repeatEffectOption(
        Effect.gen(function* () {
          const ready = yield* Queue.poll(chunks);
          if (Option.isSome(ready)) {
            yield* taken(ready.value);
            return ready.value;
          }
          if (yield* Deferred.isDone(ending)) {
            return yield* Effect.fail(Option.none<never>());
          }
          return yield* Effect.raceFirst(
            // Interruptible only while waiting: losing the race must not drop an accounted chunk.
            Effect.uninterruptibleMask((restore) => Effect.tap(restore(Queue.take(chunks)), taken)),
            Effect.andThen(Deferred.await(ending), Effect.fail(Option.none<never>())),
          );
        }),
      );

    return {
      publish: (event: TenantLogEvent) => offer(ENCODER.encode(`${JSON.stringify(event)}\n`)),
      /** An empty NDJSON line: what keeps a quiet host's request from reading as a dead one. */
      keepalive: offer(NEWLINE),
      body,
    };
  }),
}) {}
