import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { TenantLogQueue } from '#logs/queue.ts';
import { tenantLogEvent } from '#tests/support/fixtures.ts';
import { drainedLines } from '#tests/support/logs.ts';
import { provided } from '#tests/support/run.ts';

const AFTER_THE_STREAM_ENDED = 7;
const MAX_BUFFERED_BYTES = 8_388_608;

const run = provided(TenantLogQueue.Default);

function withQueue<A, E>(use: (queue: TenantLogQueue) => Effect.Effect<A, E>) {
  return run(Effect.flatMap(TenantLogQueue, use));
}

function sequences(lines: readonly string[]) {
  return lines.map((line) => JSON.parse(line).sequence as number);
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

  test('it refuses growth past its byte limit instead of blocking the producer', async () => {
    const eventBytes = new TextEncoder().encode(`${JSON.stringify(tenantLogEvent())}\n`).byteLength;
    const pastTheLimit = Math.ceil(MAX_BUFFERED_BYTES / eventBytes) + 1;
    const accepted = await withQueue((queue) =>
      Effect.forEach(
        Array.from({ length: pastTheLimit }, () => tenantLogEvent()),
        queue.publish,
      ),
    );

    expect(accepted.at(0)).toBe(true);
    expect(accepted.at(-1)).toBe(false);
  });
});
