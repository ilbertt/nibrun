import type { TenantLogEvent } from '@repo/protocol';
import { Chunk, Deferred, Effect, Stream } from 'effect';
import type { TenantLogQueue } from '#services/tenant-log-queue.service.ts';

const DECODER = new TextDecoder();

/** Everything one upload window carries, taken after the window has been ended. */
export function drainedLines(queue: TenantLogQueue) {
  return Effect.gen(function* () {
    const ending = yield* Deferred.make<void>();
    yield* Deferred.succeed(ending, undefined);
    const upload = yield* queue.body(ending);
    const chunks = Chunk.toReadonlyArray(yield* Stream.runCollect(upload));
    return chunks.map((chunk) => DECODER.decode(chunk));
  });
}

export function drainedEvents(queue: TenantLogQueue) {
  return Effect.map(drainedLines(queue), (lines) =>
    lines.map((line) => JSON.parse(line) as TenantLogEvent),
  );
}
