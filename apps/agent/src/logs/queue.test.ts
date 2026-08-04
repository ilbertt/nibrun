import { describe, expect, test } from 'bun:test';
import type { AppId, DeploymentId, InstanceId, TenantLogEvent, Timestamp } from '@repo/protocol';
import { Chunk, Deferred, Effect, Stream } from 'effect';
import { TenantLogQueue } from '#logs/queue.ts';

const AFTER_THE_STREAM_ENDED = 7;
const MAX_BUFFERED_BYTES = 8_388_608;

function event(sequence = 0): TenantLogEvent {
  return {
    kind: 'data',
    sourceId: 'source-1',
    sequence,
    observedAt: '2026-08-04T12:00:00Z' as Timestamp,
    appId: 'app-1' as AppId,
    deploymentId: 'deployment-1' as DeploymentId,
    instanceId: 'instance-1' as InstanceId,
    stream: 'stdout',
    text: 'hello\n',
  };
}

const decoder = new TextDecoder();

const withQueue = <A>(use: (queue: TenantLogQueue) => Effect.Effect<A, never, never>) =>
  Effect.runPromise(Effect.provide(Effect.flatMap(TenantLogQueue, use), TenantLogQueue.Default));

/** Everything one upload window carries, once the window has been ended. */
const drain = (queue: TenantLogQueue) =>
  Effect.gen(function* () {
    const ending = yield* Deferred.make<void>();
    yield* Deferred.succeed(ending, undefined);
    return Chunk.toReadonlyArray(yield* Stream.runCollect(queue.body(ending)));
  });

const lines = (chunks: readonly Uint8Array[]) => chunks.map((chunk) => decoder.decode(chunk));

describe('the bounded upload queue', () => {
  test('it emits one complete NDJSON event at a time', async () => {
    const emitted = await withQueue((queue) =>
      Effect.gen(function* () {
        yield* queue.publish(event());
        return yield* drain(queue);
      }),
    );

    expect(emitted.length).toBe(1);
    expect(JSON.parse(lines(emitted)[0] ?? '')).toEqual(event());
  });

  // A host whose apps are quiet still has to hold the request open, and every timeout between
  // here and the control plane counts silence as a dead connection.
  test('a keepalive is an empty line, so it carries no event', async () => {
    const emitted = await withQueue((queue) =>
      Effect.gen(function* () {
        yield* queue.keepalive;
        return yield* drain(queue);
      }),
    );

    expect(lines(emitted)).toEqual(['\n']);
  });

  // The point of ending a stream rather than cutting it: an upload cut mid-flight loses whatever
  // the request had already taken, and HTTP cannot say how much that was.
  test('ending a stream hands over everything queued before it stops', async () => {
    const emitted = await withQueue((queue) =>
      Effect.gen(function* () {
        yield* queue.publish(event(1));
        yield* queue.publish(event(2));
        return yield* drain(queue);
      }),
    );

    expect(lines(emitted).map((line) => JSON.parse(line).sequence)).toEqual([1, 2]);
  });

  test('an event that arrives after a stream ended waits for the one that replaces it', async () => {
    const emitted = await withQueue((queue) =>
      Effect.gen(function* () {
        yield* drain(queue);
        yield* queue.publish(event(AFTER_THE_STREAM_ENDED));
        return yield* drain(queue);
      }),
    );

    expect(lines(emitted).map((line) => JSON.parse(line).sequence)).toEqual([
      AFTER_THE_STREAM_ENDED,
    ]);
  });

  // The window fires whether or not the queue happens to be empty, and an idle host is the case
  // where it always is.
  test('a stream ended while nothing is queued closes rather than hanging', async () => {
    expect(await withQueue(drain)).toEqual([]);
  });

  test('it refuses growth past its byte limit instead of blocking the producer', async () => {
    const eventBytes = new TextEncoder().encode(`${JSON.stringify(event())}\n`).byteLength;
    const pastTheLimit = Math.ceil(MAX_BUFFERED_BYTES / eventBytes) + 1;
    const accepted = await withQueue((queue) =>
      Effect.forEach(
        Array.from({ length: pastTheLimit }, () => event()),
        queue.publish,
      ),
    );

    expect(accepted.at(0)).toBe(true);
    expect(accepted.at(-1)).toBe(false);
  });
});
