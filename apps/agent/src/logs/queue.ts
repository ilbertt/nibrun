import type { TenantLogEvent } from '@repo/protocol';
import { Chunk, Deferred, Effect, Option, Queue, Ref, Stream } from 'effect';

export const MAX_BUFFERED_BYTES = 8_388_608;

/**
 * How much one upload may carry before it ends and asks to be confirmed.
 *
 * What a request has taken is held here until the control plane answers, so this is the memory a
 * failure is allowed to be worth — small beside the buffer above, and large beside anything a
 * tenant produces between two answers. A quiet host never reaches it and cycles on time instead.
 */
export const MAX_IN_FLIGHT_BYTES = 1_048_576;

const ENCODER = new TextEncoder();
const NEWLINE = ENCODER.encode('\n');

export class TenantLogQueue extends Effect.Service<TenantLogQueue>()('TenantLogQueue', {
  effect: Effect.gen(function* () {
    const chunks = yield* Queue.unbounded<Uint8Array>();
    /**
     * What an upload took and never had confirmed, waiting for the upload that replaces it.
     *
     * A queue of its own rather than a way back into `chunks`, because an Effect queue only grows
     * at the back and these are older than everything published since. A body drains this to
     * exhaustion before it looks at anything newer, which is the same order without the surgery.
     */
    const owed = yield* Queue.unbounded<Uint8Array>();
    const inFlight = yield* Queue.unbounded<Uint8Array>();
    const inFlightBytes = yield* Ref.make(0);
    const bufferedBytes = yield* Ref.make(0);

    const offer = (chunk: Uint8Array) =>
      Effect.gen(function* () {
        // In-flight bytes are counted here too. A copy held for an unconfirmed request is the same
        // memory as an event nobody has sent yet, so it answers to the same limit — a budget that
        // only counted what had not been sent yet would be a budget for half the bytes.
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

    const hold = (chunk: Uint8Array) =>
      Effect.andThen(
        Queue.offer(inFlight, chunk),
        Ref.update(inFlightBytes, (bytes) => bytes + chunk.byteLength),
      );

    /** One step, because a chunk out of a queue and not yet held is a chunk nobody is holding. */
    const pollAndHold = (source: Queue.Queue<Uint8Array>) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const taken = yield* Queue.poll(source);
          if (Option.isSome(taken)) {
            yield* hold(taken.value);
          }
          return taken;
        }),
      );

    const recover = Effect.gen(function* () {
      const unconfirmed = yield* Queue.takeAll(inFlight);
      if (Chunk.isEmpty(unconfirmed)) {
        return;
      }
      yield* Ref.set(inFlightBytes, 0);
      const stillOwed = yield* Queue.takeAll(owed);
      yield* Queue.offerAll(owed, Chunk.appendAll(unconfirmed, stillOwed));
    });

    /**
     * The control plane answered, so what that request carried is somewhere other than here and
     * the copies held for it can go.
     *
     * Only ever reached by a request that ran long enough to have been read. A reply that arrives
     * too quickly to have consumed a body is the one success that proves nothing, and keeping the
     * copies through it costs a duplicate where believing it would cost the events.
     */
    const acknowledge = Effect.gen(function* () {
      yield* Queue.takeAll(inFlight);
      const released = yield* Ref.getAndSet(inFlightBytes, 0);
      yield* Ref.update(bufferedBytes, (bytes) => bytes - released);
    });

    const endOfBody = Effect.fail(Option.none<never>());

    const nextChunk = (ending: Deferred.Deferred<void>) =>
      Effect.gen(function* () {
        // A window ends on what it is carrying as well as on how long it has been open. An answer
        // is the only thing that frees a copy, so how much one request may take is how much this
        // host is willing to hold — and a talkative tenant reaches that long before thirty seconds.
        if ((yield* Ref.get(inFlightBytes)) >= MAX_IN_FLIGHT_BYTES) {
          return yield* endOfBody;
        }
        const owedBack = yield* pollAndHold(owed);
        if (Option.isSome(owedBack)) {
          return owedBack.value;
        }
        const ready = yield* pollAndHold(chunks);
        if (Option.isSome(ready)) {
          return ready.value;
        }
        if (yield* Deferred.isDone(ending)) {
          return yield* endOfBody;
        }
        return yield* Effect.raceFirst(
          // Interruptible only while waiting: losing the race must not drop an unheld chunk.
          Effect.uninterruptibleMask((restore) => Effect.tap(restore(Queue.take(chunks)), hold)),
          Effect.andThen(Deferred.await(ending), endOfBody),
        );
      });

    /**
     * The body of one upload, which ends at a drained queue and nowhere else: an upload cut
     * mid-flight loses whatever the request had already taken, and HTTP cannot say how much.
     *
     * Opening one takes back what the upload it supersedes was carrying, ahead of anything
     * published since. Never confirmed is still owed.
     */
    const body = (ending: Deferred.Deferred<void>) =>
      Effect.as(recover, Stream.repeatEffectOption(nextChunk(ending)));

    return {
      publish: (event: TenantLogEvent) => offer(ENCODER.encode(`${JSON.stringify(event)}\n`)),
      /** An empty NDJSON line: what keeps a quiet host's request from reading as a dead one. */
      keepalive: offer(NEWLINE),
      acknowledge,
      body,
    };
  }),
}) {}
