import { Chunk, Effect, Queue, Ref } from 'effect';
import type { TenantLogEvent } from '#lib/logs/event.ts';

export const MAX_BUFFERED_BYTES = 8_388_608;

/**
 * How much one batch may carry.
 *
 * What a batch took is held here until the store answers, so this is the memory a failure is
 * allowed to be worth — small beside the buffer above, and large beside anything a tenant
 * produces between two answers.
 */
export const MAX_BATCH_BYTES = 1_048_576;

/**
 * Rough enough: what this bounds is memory, and being a little out costs a buffer that holds
 * slightly more or less than asked. Measuring exactly would mean serialising every event on
 * arrival, which is work the upload does anyway and most events never need twice.
 */
const OVERHEAD_BYTES_PER_EVENT = 256;

const sizeOf = (event: TenantLogEvent) =>
  (event.kind === 'data' ? event.text.length : 0) + OVERHEAD_BYTES_PER_EVENT;

const totalBytes = (events: readonly TenantLogEvent[]) => {
  let total = 0;
  for (const event of events) {
    total += sizeOf(event);
  }
  return total;
};

/**
 * Everything the host has seen and not yet handed to the log store, bounded.
 *
 * Batches rather than a stream, which is what makes this as small as it is: an HTTP upload has no
 * per-chunk acknowledgement, so a stream can only be ended where the sender knows nothing is in
 * flight. A batch is acknowledged by its own response, so a failed one is simply sent again.
 */
export class TenantLogQueue extends Effect.Service<TenantLogQueue>()('TenantLogQueue', {
  effect: Effect.gen(function* () {
    const pending = yield* Queue.unbounded<TenantLogEvent>();
    /**
     * What a batch took and never had confirmed, waiting for the batch that replaces it.
     *
     * A queue of its own rather than a way back into `pending`, because an Effect queue only grows
     * at the back and these are older than everything published since. A batch drains this to
     * exhaustion before it looks at anything newer, which is the same order without the surgery.
     */
    const owed = yield* Queue.unbounded<TenantLogEvent>();
    // In-flight bytes are counted here too. A batch held for an unconfirmed request is the same
    // memory as an event nobody has sent yet, so it answers to the same limit — a budget that only
    // counted what had not been sent would be a budget for half the bytes.
    const bufferedBytes = yield* Ref.make(0);

    const publish = (event: TenantLogEvent) =>
      Effect.gen(function* () {
        const bytes = sizeOf(event);
        const accepted = yield* Ref.modify(bufferedBytes, (held) =>
          held + bytes > MAX_BUFFERED_BYTES
            ? ([false, held] as const)
            : ([true, held + bytes] as const),
        );
        if (accepted) {
          yield* Queue.offer(pending, event);
        }
        return accepted;
      });

    /**
     * Up to `maxBytes` worth, oldest first: what a previous batch is still owed, then anything
     * published since.
     *
     * Both queues are drained and the remainder returned to `owed`, rather than the batch being
     * assembled by peeking. An Effect queue only grows at the back, so putting an over-large
     * event back where it came from would move it behind everything already there — and tenant
     * output that arrives out of order is worse than output that arrives late.
     */
    const take = ({ maxBytes }: { maxBytes: number }) =>
      Effect.gen(function* () {
        const queued = [
          ...Chunk.toReadonlyArray(yield* Queue.takeAll(owed)),
          ...Chunk.toReadonlyArray(yield* Queue.takeAll(pending)),
        ];
        const batch: TenantLogEvent[] = [];
        let bytes = 0;
        let index = 0;
        for (const event of queued) {
          const size = sizeOf(event);
          // At least one event leaves however large it is: one bigger than a whole batch would
          // otherwise be taken by no batch at all, and sit at the head blocking everything behind.
          if (batch.length > 0 && bytes + size > maxBytes) {
            break;
          }
          bytes += size;
          batch.push(event);
          index += 1;
        }
        const rest = queued.slice(index);
        if (rest.length > 0) {
          yield* Queue.offerAll(owed, rest);
        }
        return batch;
      });

    return {
      publish,
      take,
      /** The store answered, so what that batch carried is somewhere other than here. */
      release: (events: readonly TenantLogEvent[]) =>
        Ref.update(bufferedBytes, (held) => held - totalBytes(events)),
      /**
       * A batch nothing received, back in front of whatever arrived while it was in flight.
       *
       * Its bytes were counted when they were first accepted and stay counted, so this never
       * refuses: the one batch the host has proof nothing received is the last thing a full
       * buffer should drop.
       */
      restore: (events: readonly TenantLogEvent[]) =>
        Effect.gen(function* () {
          const stillOwed = yield* Queue.takeAll(owed);
          yield* Queue.offerAll(owed, Chunk.appendAll(Chunk.fromIterable(events), stillOwed));
        }),
      isEmpty: Effect.map(
        Effect.all([Queue.size(owed), Queue.size(pending)]),
        ([owedSize, pendingSize]) => owedSize + pendingSize === 0,
      ),
    };
  }),
}) {}
