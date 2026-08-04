import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import {
  MAX_BUFFERED_BYTES,
  MAX_IN_FLIGHT_BYTES,
  TenantLogQueue,
} from '#services/tenant-log-queue.service.ts';
import { tenantLogEvent } from '#tests/support/fixtures.ts';
import { drainedLines } from '#tests/support/logs.ts';
import { provided } from '#tests/support/run.ts';

const AFTER_THE_STREAM_ENDED = 7;
const ENCODER = new TextEncoder();

// Sized from the encoding rather than guessed, so a field added to the event does not silently
// turn "more than the buffer holds" into less than it holds.
const EVENT_BYTES = ENCODER.encode(`${JSON.stringify(tenantLogEvent())}\n`).byteLength;

const run = provided(TenantLogQueue.Default);

function withQueue<A, E>(use: (queue: TenantLogQueue) => Effect.Effect<A, E>) {
  return run(Effect.flatMap(TenantLogQueue, use));
}

/** More than the buffer holds, sequenced so what one window carried can be told from the rest. */
function pastTheBufferLimit() {
  return Array.from(Array(Math.ceil(MAX_BUFFERED_BYTES / EVENT_BYTES) + 1).keys()).map((sequence) =>
    tenantLogEvent(sequence),
  );
}

function publishUntilRefused(queue: TenantLogQueue) {
  return Effect.forEach(pastTheBufferLimit(), queue.publish);
}

function sequences(lines: readonly string[]) {
  return lines.map((line) => JSON.parse(line).sequence as number);
}

function carriedBytes(lines: readonly string[]) {
  return ENCODER.encode(lines.join('')).byteLength;
}

describe('the bounded upload queue', () => {
  test('it emits one complete NDJSON event at a time', async () => {
    const lines = await withQueue((queue) =>
      Effect.andThen(queue.publish(tenantLogEvent()), drainedLines(queue)),
    );

    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0] ?? '')).toEqual(tenantLogEvent());
  });

  // A host whose apps are quiet still has to hold the request open, and every timeout between
  // here and the control plane counts silence as a dead connection.
  test('a keepalive is an empty line, so it carries no event', async () => {
    const lines = await withQueue((queue) => Effect.andThen(queue.keepalive, drainedLines(queue)));

    expect(lines).toEqual(['\n']);
  });

  // The point of ending a stream rather than cutting it: an upload cut mid-flight loses whatever
  // the request had already taken, and HTTP cannot say how much that was.
  test('ending a stream hands over everything queued before it stops', async () => {
    const lines = await withQueue((queue) =>
      Effect.gen(function* () {
        yield* queue.publish(tenantLogEvent(1));
        yield* queue.publish(tenantLogEvent(2));
        return yield* drainedLines(queue);
      }),
    );

    expect(sequences(lines)).toEqual([1, 2]);
  });

  test('an event that arrives after a stream ended waits for the one that replaces it', async () => {
    const lines = await withQueue((queue) =>
      Effect.gen(function* () {
        yield* drainedLines(queue);
        yield* queue.publish(tenantLogEvent(AFTER_THE_STREAM_ENDED));
        return yield* drainedLines(queue);
      }),
    );

    expect(sequences(lines)).toEqual([AFTER_THE_STREAM_ENDED]);
  });

  // The window fires whether or not the queue happens to be empty, and an idle host is the case
  // where it always is.
  test('a stream ended while nothing is queued closes rather than hanging', async () => {
    expect(await withQueue(drainedLines)).toEqual([]);
  });

  // The whole point of holding copies: a request that dies takes nothing with it.
  test('an upload that is never confirmed hands its events to the next one', async () => {
    const { failed, replacement } = await withQueue((queue) =>
      Effect.gen(function* () {
        yield* queue.publish(tenantLogEvent(1));
        yield* queue.publish(tenantLogEvent(2));
        const failed = yield* drainedLines(queue);
        return { failed, replacement: yield* drainedLines(queue) };
      }),
    );

    expect(sequences(failed)).toEqual([1, 2]);
    expect(sequences(replacement)).toEqual([1, 2]);
  });

  test('a confirmed upload does not hand them over again', async () => {
    const { delivered, replacement } = await withQueue((queue) =>
      Effect.gen(function* () {
        yield* queue.publish(tenantLogEvent(1));
        const delivered = yield* drainedLines(queue);
        yield* queue.acknowledge;
        return { delivered, replacement: yield* drainedLines(queue) };
      }),
    );

    expect(sequences(delivered)).toEqual([1]);
    expect(replacement).toEqual([]);
  });

  // Copies are held until they are confirmed, so a request that is never confirmed must not be
  // able to hold more of this host's memory than the buffer it was drawn from.
  test('what is held for an unconfirmed upload answers to the same byte limit', async () => {
    const { whileHeld, onceConfirmed } = await withQueue((queue) =>
      Effect.gen(function* () {
        yield* publishUntilRefused(queue);
        yield* drainedLines(queue);
        // What that window took is in flight rather than queued, and the budget has not reopened
        // because of it.
        const whileHeld = yield* queue.publish(tenantLogEvent());
        yield* queue.acknowledge;
        return { whileHeld, onceConfirmed: yield* queue.publish(tenantLogEvent()) };
      }),
    );

    expect(whileHeld).toBe(false);
    expect(onceConfirmed).toBe(true);
  });

  test('an upload ends once it is carrying its limit, leaving the rest queued', async () => {
    const { carried, next } = await withQueue((queue) =>
      Effect.gen(function* () {
        yield* publishUntilRefused(queue);
        const carried = yield* drainedLines(queue);
        yield* queue.acknowledge;
        return { carried, next: yield* drainedLines(queue) };
      }),
    );

    expect(carriedBytes(carried)).toBeGreaterThanOrEqual(MAX_IN_FLIGHT_BYTES);
    expect(carriedBytes(carried)).toBeLessThan(MAX_BUFFERED_BYTES);
    expect(sequences(next).at(0)).toBe(carried.length);
  });

  test('it refuses growth past its byte limit instead of blocking the producer', async () => {
    const accepted = await withQueue(publishUntilRefused);

    expect(accepted.at(0)).toBe(true);
    expect(accepted.at(-1)).toBe(false);
  });
});
