import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import type { TenantLogEvent } from '#lib/logs/event.ts';
import {
  MAX_BATCH_BYTES,
  MAX_BUFFERED_BYTES,
  TenantLogQueue,
} from '#services/tenant-log-queue.service.ts';
import { tenantLogEvent } from '#tests/support/fixtures.ts';
import { drainedEvents } from '#tests/support/logs.ts';
import { provided } from '#tests/support/run.ts';

const AFTER_THE_BATCH_LEFT = 7;

const run = provided(TenantLogQueue.Default);

function withQueue<A, E>(use: (queue: TenantLogQueue) => Effect.Effect<A, E>) {
  return run(Effect.flatMap(TenantLogQueue, use));
}

function sequences(events: readonly TenantLogEvent[]) {
  return events.map((event) => event.sequence);
}

/**
 * Publishes until the buffer says no, counting what it took.
 *
 * Counted rather than computed from a byte size, so the sizing the queue actually uses stays its
 * own business — a field added to an event cannot silently turn "more than the buffer holds" into
 * less than it holds.
 */
function publishUntilRefused(queue: TenantLogQueue) {
  return Effect.gen(function* () {
    let accepted = 0;
    for (;;) {
      if (!(yield* queue.publish(tenantLogEvent(accepted)))) {
        return accepted;
      }
      accepted += 1;
    }
  });
}

describe('the bounded log buffer', () => {
  test('a batch carries what was published into it', async () => {
    const events = await withQueue((queue) =>
      Effect.andThen(queue.publish(tenantLogEvent()), drainedEvents(queue)),
    );

    expect(events.length).toBe(1);
    expect(events[0]).toEqual(tenantLogEvent());
  });

  test('it hands them over oldest first', async () => {
    const events = await withQueue((queue) =>
      Effect.gen(function* () {
        yield* queue.publish(tenantLogEvent(1));
        yield* queue.publish(tenantLogEvent(2));
        return yield* drainedEvents(queue);
      }),
    );

    expect(sequences(events)).toEqual([1, 2]);
  });

  test('an event published after a batch left waits for the one that replaces it', async () => {
    const events = await withQueue((queue) =>
      Effect.gen(function* () {
        yield* drainedEvents(queue);
        yield* queue.publish(tenantLogEvent(AFTER_THE_BATCH_LEFT));
        return yield* drainedEvents(queue);
      }),
    );

    expect(sequences(events)).toEqual([AFTER_THE_BATCH_LEFT]);
  });

  test('an empty buffer yields an empty batch rather than waiting for one', async () => {
    expect(await withQueue(drainedEvents)).toEqual([]);
  });

  // The whole point of taking a batch rather than streaming: a request that dies takes nothing
  // with it, because what it was carrying is put back.
  test('a batch nothing received is handed to the next one', async () => {
    const { failed, replacement } = await withQueue((queue) =>
      Effect.gen(function* () {
        yield* queue.publish(tenantLogEvent(1));
        yield* queue.publish(tenantLogEvent(2));
        const failed = yield* drainedEvents(queue);
        yield* queue.restore(failed);
        return { failed, replacement: yield* drainedEvents(queue) };
      }),
    );

    expect(sequences(failed)).toEqual([1, 2]);
    expect(sequences(replacement)).toEqual([1, 2]);
  });

  // Ordering is the reason a restored batch has a queue of its own: it is older than everything
  // published while it was in flight.
  test('a restored batch goes back in front of what arrived meanwhile', async () => {
    const events = await withQueue((queue) =>
      Effect.gen(function* () {
        yield* queue.publish(tenantLogEvent(1));
        const failed = yield* drainedEvents(queue);
        yield* queue.publish(tenantLogEvent(2));
        yield* queue.restore(failed);
        return yield* drainedEvents(queue);
      }),
    );

    expect(sequences(events)).toEqual([1, 2]);
  });

  test('a released batch is not handed over again', async () => {
    const { delivered, replacement } = await withQueue((queue) =>
      Effect.gen(function* () {
        yield* queue.publish(tenantLogEvent(1));
        const delivered = yield* drainedEvents(queue);
        yield* queue.release(delivered);
        return { delivered, replacement: yield* drainedEvents(queue) };
      }),
    );

    expect(sequences(delivered)).toEqual([1]);
    expect(replacement).toEqual([]);
  });

  // A batch held for an unanswered request is the same memory as an event nobody has sent yet,
  // so it must not be able to hold more of this host than the buffer it was drawn from.
  test('a batch in flight still answers to the buffer limit', async () => {
    const { whileHeld, onceReleased } = await withQueue((queue) =>
      Effect.gen(function* () {
        yield* publishUntilRefused(queue);
        const batch = yield* queue.take({ maxBytes: MAX_BUFFERED_BYTES });
        // Taken rather than queued, and the budget has not reopened because of it.
        const whileHeld = yield* queue.publish(tenantLogEvent());
        yield* queue.release(batch);
        return { whileHeld, onceReleased: yield* queue.publish(tenantLogEvent()) };
      }),
    );

    expect(whileHeld).toBe(false);
    expect(onceReleased).toBe(true);
  });

  test('a batch stops at its own limit, leaving the rest buffered', async () => {
    const { accepted, carried, next } = await withQueue((queue) =>
      Effect.gen(function* () {
        const accepted = yield* publishUntilRefused(queue);
        const carried = yield* queue.take({ maxBytes: MAX_BATCH_BYTES });
        yield* queue.release(carried);
        return { accepted, carried, next: yield* drainedEvents(queue) };
      }),
    );

    expect(carried.length).toBeLessThan(accepted);
    expect(next.length).toBe(accepted - carried.length);
    // The rest continues where the batch stopped, so nothing was reordered across the boundary.
    expect(sequences(next).at(0)).toBe(carried.length);
  });

  test('it refuses growth past its byte limit instead of blocking the producer', async () => {
    const accepted = await withQueue(publishUntilRefused);

    expect(accepted).toBeGreaterThan(0);
  });
});
