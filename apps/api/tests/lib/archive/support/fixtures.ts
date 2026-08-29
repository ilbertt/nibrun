// What every walk of an archive is handed and what it is looking for, shared by the two formats:
// a zip and a tarball are read through the same source and answered in the same terms, so the
// fixtures that stand for a release download belong to neither of them.

import { Buffer } from 'node:buffer';
import { MAX_ENTRIES } from '#lib/archive/walk.ts';

const NOTE_LINES = 8;

/** What the api will store, and the only thing a walk of an archive is looking for. */
export const BINARY = bytesOf('\x7fELFnibrun-test-binary');
export const NOTES = bytesOf('# Changelog\n\nEverything, all at once.\n'.repeat(NOTE_LINES));
export const LICENCE = bytesOf('The MIT Licence, as every release archive carries it.\n');
export const NOTHING = new Uint8Array(0);

/** Larger than any fixture here, so a walk only stops early when stopping early is the test. */
export const NO_LIMIT = 1_048_576;

/**
 * Small enough to fall inside a header, a name and the window a descriptor is looked for in, so
 * every fixture is read across chunk boundaries rather than out of one buffer.
 */
export const CHUNK_BYTES = 7;

/** Shorter than the notes a release archive opens with, so the walk gives up inside them. */
export const A_SHORT_WALK = 8;

/** One past what a walk will read the headers of. */
export const PAST_THE_ENTRY_LIMIT = MAX_ENTRIES + 1;

export function bytesOf(text: string): Uint8Array {
  return Buffer.from(text, 'utf8');
}

export function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return sourceOf({ bytes }).stream;
}

/** An archive, and whether whoever was reading it let go of it before it ended. */
export function sourceOf({
  bytes,
  chunkBytes = CHUNK_BYTES,
}: {
  bytes: Uint8Array;
  chunkBytes?: number;
}): {
  stream: ReadableStream<Uint8Array>;
  wasLetGo: () => boolean;
} {
  let at = 0;
  let letGo = false;

  function pull(controller: ReadableStreamDefaultController<Uint8Array>): void {
    if (at >= bytes.byteLength) {
      controller.close();
      return;
    }
    controller.enqueue(bytes.subarray(at, at + chunkBytes));
    at += chunkBytes;
  }

  function cancel(): void {
    letGo = true;
  }

  function wasLetGo(): boolean {
    return letGo;
  }

  return { stream: new ReadableStream<Uint8Array>({ pull, cancel }), wasLetGo };
}

/**
 * Bytes a compressor cannot shrink, so a fixture built around them is as long on the way in as it
 * is on the way out. A walk that gives up on a source short enough to have already arrived proves
 * nothing about letting go of it: that source was going to end either way.
 */
export function incompressible(sizeBytes: number): Uint8Array {
  const bytes = Buffer.alloc(sizeBytes);
  // Xorshift rather than a linear congruential generator, which gzip finds the shape of and packs
  // thirty times over however many of its bits are taken. Written out rather than drawn at random
  // so that a fixture that starts failing is the same fixture it was passing on.
  let state = 0x9e37_79b9;
  for (let at = 0; at < sizeBytes; at++) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    bytes[at] = state & 0xff;
  }
  return bytes;
}

export async function collected(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
