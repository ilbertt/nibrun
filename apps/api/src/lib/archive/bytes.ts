// The bytes an archive is read out of, a piece at a time and forwards only, which is the shape a
// fetch gives them in. Nothing here knows what an archive is: a zip and a tarball ask the same
// things of a source, and only what they make of the answers differs.

import { Buffer } from 'node:buffer';
import type { Duplex } from 'node:stream';
import { Readable } from 'node:stream';
import { EntryTooLargeError, UnreadableArchiveError } from '#lib/archive/walk.ts';
import { ArtifactTooLargeError } from '#lib/artifact-digest.ts';

/** The stream's first bytes, and the stream itself with them still in front of it. */
export async function peeked({
  stream,
  count,
}: {
  stream: ReadableStream<Uint8Array>;
  count: number;
}): Promise<{ head: Uint8Array; body: ReadableStream<Uint8Array> }> {
  const rest = stream[Symbol.asyncIterator]();
  const opening: Uint8Array[] = [];
  let held = 0;

  while (held < count) {
    const { done, value } = await rest.next();
    if (done) {
      break;
    }
    opening.push(value);
    held += value.byteLength;
  }

  return { head: Buffer.concat(opening), body: streamed(replayed({ opening, rest })) };
}

async function* replayed({
  opening,
  rest,
}: {
  opening: Uint8Array[];
  rest: AsyncIterator<Uint8Array>;
}): AsyncGenerator<Uint8Array> {
  try {
    yield* opening;
    while (true) {
      const { done, value } = await rest.next();
      if (done) {
        return;
      }
      yield value;
    }
  } finally {
    await rest.return?.();
  }
}

/** What the entry came to, stopping at the point reading more of it would prove nothing. */
export async function drained({
  stream,
  budget,
}: {
  stream: ReadableStream<Uint8Array>;
  budget: number;
}): Promise<number> {
  let read = 0;
  for await (const chunk of stream) {
    read += chunk.byteLength;
    // Leaving the loop cancels the read: an entry already past what will be walked is one nobody
    // is going to reach the end of.
    if (read > budget) {
      break;
    }
  }
  return read;
}

/**
 * The source as bytes to be read a piece at a time, holding whatever has arrived and not yet been
 * taken. Chunks are joined only where something reaches across two of them — a header, or the
 * window a descriptor could be sitting in — so what is held is a chunk and a remainder rather than
 * the archive.
 */
export type Queued = {
  /** At least `count` bytes, left where they are; `undefined` where the source ended first. */
  need(count: number): Promise<Buffer | undefined>;
  take(count: number): Promise<Buffer | undefined>;
  /** Whatever is in hand, after pulling once where there is nothing. */
  holding(): Promise<Buffer>;
  drop(count: number): void;
  more(): Promise<boolean>;
  /** What is left of the source, the bytes in hand first. */
  rest(): ReadableStream<Uint8Array>;
  cancel(): Promise<void>;
};

export function queued(source: ReadableStream<Uint8Array>): Queued {
  const chunks = source[Symbol.asyncIterator]();
  let held = Buffer.alloc(0);
  let ended = false;

  async function pull(): Promise<boolean> {
    if (ended) {
      return false;
    }
    const { done, value } = await chunks.next();
    if (done) {
      ended = true;
      return false;
    }
    held = Buffer.concat([held, value]);
    return true;
  }

  async function need(count: number): Promise<Buffer | undefined> {
    while (held.length < count) {
      if (!(await pull())) {
        return undefined;
      }
    }
    return held.subarray(0, count);
  }

  function drop(count: number): void {
    held = held.subarray(count);
  }

  return {
    need,
    drop,
    more: pull,
    async take(count) {
      const head = await need(count);
      if (head === undefined) {
        return undefined;
      }
      const taken = Buffer.from(head);
      drop(count);
      return taken;
    },
    async holding() {
      while (held.length === 0) {
        if (!(await pull())) {
          break;
        }
      }
      return held;
    },
    rest() {
      return streamed(replayed({ opening: [held], rest: chunks }));
    },
    async cancel() {
      await chunks.return?.();
    },
  };
}

/** A generator as the stream everything downstream of here reads, pulled one chunk at a time. */
export function streamed(source: AsyncGenerator<Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await source.next();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    async cancel() {
      await source.return(undefined);
    },
  });
}

/**
 * The executable's bytes, and the source let go of after the last of them. What follows the entry
 * is the rest of the archive's own bookkeeping, which nothing here reads.
 */
export async function* closing({
  body,
  bytes,
}: {
  body: ReadableStream<Uint8Array>;
  bytes: Queued;
}): AsyncGenerator<Uint8Array> {
  try {
    yield* body;
  } finally {
    await bytes.cancel();
  }
}

/**
 * A source read through a zlib engine — whatever the compressed bytes turn out to be, including
 * that they were never in that compression at all.
 */
export async function* decompressed({
  engine,
  data,
}: {
  engine: Duplex;
  data: AsyncIterable<Uint8Array>;
}): AsyncGenerator<Uint8Array> {
  const compressed = Readable.from(data);
  // Piping does not carry a failure the other way, and the source failing is the ordinary way
  // this ends: an archive that stopped part way has to stop the inflate reading it.
  compressed.on('error', (failure) => engine.destroy(failure));
  compressed.pipe(engine);

  try {
    yield* engine;
  } catch (failure) {
    // The source running out of what it was allowed to send, and an entry whose length nothing
    // could read: those are verdicts on the bytes rather than on the archive, and the two this is
    // not entitled to restate as an archive that ended early.
    throw failure instanceof ArtifactTooLargeError || failure instanceof EntryTooLargeError
      ? failure
      : new UnreadableArchiveError();
  }
}

/** Exactly the length the entry said, and an archive that ended early where it is not there. */
export async function* ofSize({
  bytes,
  sizeBytes,
}: {
  bytes: Queued;
  sizeBytes: number;
}): AsyncGenerator<Uint8Array> {
  let left = sizeBytes;
  while (left > 0) {
    const held = await bytes.holding();
    if (held.length === 0) {
      throw new UnreadableArchiveError();
    }
    const taken = Math.min(left, held.length);
    yield held.subarray(0, taken);
    bytes.drop(taken);
    left -= taken;
  }
}
