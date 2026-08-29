// A zip read the only way a fetch can read one: forwards, once, with a chunk in hand.
//
// The index a zip is meant to be opened by sits at its end, which is behind the bytes as they
// arrive — so nothing here uses it. Each entry is taken from the header that precedes its data
// instead, and the executable is whichever entry's first bytes say it is one. A release archive
// is a binary and a couple of text files, so that is a walk of two or three entries.

import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import { createInflateRaw } from 'node:zlib';
import { ArtifactTooLargeError } from '#lib/artifact-digest.ts';
import { ELF_MAGIC_LENGTH, isElfExecutable } from '#lib/elf.ts';

const LOCAL_HEADER = signature('PK\x03\x04');
const CENTRAL_HEADER = signature('PK\x01\x02');
const DATA_DESCRIPTOR = signature('PK\x07\x08');

function signature(bytes: string): Buffer {
  return Buffer.from(bytes, 'latin1');
}

/** What an entry is always followed by: the next one, or the directory the entries end at. */
const FOLLOWING_RECORDS = [LOCAL_HEADER, CENTRAL_HEADER];

const SIGNATURE_BYTES = LOCAL_HEADER.length;
const LOCAL_HEADER_BYTES = 30;
const CRC_BYTES = 4;
const SIZE_BYTES = 4;
/** The width a zip64 entry writes both its sizes in, in its descriptor as in its header. */
const ZIP64_SIZE_BYTES = 8;

type DescriptorShape = {
  signed: boolean;
  sizeBytes: number;
  compressedSizeAt: number;
  totalBytes: number;
};

function descriptorShape({
  signed,
  sizeBytes,
}: {
  signed: boolean;
  sizeBytes: number;
}): DescriptorShape {
  const compressedSizeAt = (signed ? SIGNATURE_BYTES : 0) + CRC_BYTES;
  return { signed, sizeBytes, compressedSizeAt, totalBytes: compressedSizeAt + 2 * sizeBytes };
}

/**
 * The shapes a descriptor is written in. The format never assigned it a signature — that is a
 * convention writers adopted — and an entry that declared zip64 writes both its sizes eight bytes
 * wide, so which shape an archive used is read back off the archive rather than assumed. Widest
 * first, so the shape that has to agree in the most places is the one that gets to.
 */
const DESCRIPTOR_SHAPES = [
  descriptorShape({ signed: true, sizeBytes: ZIP64_SIZE_BYTES }),
  descriptorShape({ signed: false, sizeBytes: ZIP64_SIZE_BYTES }),
  descriptorShape({ signed: true, sizeBytes: SIZE_BYTES }),
  descriptorShape({ signed: false, sizeBytes: SIZE_BYTES }),
];

/** Nothing is handed on until it is past both a descriptor and the record that would follow it. */
const HELD_BACK_BYTES =
  Math.max(...DESCRIPTOR_SHAPES.map((shape) => shape.totalBytes)) + SIGNATURE_BYTES;

const FLAGS_AT = 6;
const METHOD_AT = 8;
const COMPRESSED_SIZE_AT = 18;
const NAME_LENGTH_AT = 26;
const EXTRA_LENGTH_AT = 28;

const FLAG_ENCRYPTED = 0x01;
/** Set by every writer that cannot seek back to fill the header in, which is every release build. */
const FLAG_SIZES_IN_DESCRIPTOR = 0x08;

const METHOD_DEFLATE = 8;

/** What a size field says when the real one is in a zip64 extra field, which is past our cap. */
const SIZE_IN_ZIP64_EXTRA = 0xff_ff_ff_ff;

const PATH_SEPARATOR = '/';

/**
 * How many entries a walk will read the headers of.
 *
 * An entry that declares no data costs nothing against `maxSkippedBytes`, so an archive that is
 * headers the whole way down is bounded only by how many of them fit inside the cap on the fetch.
 * Each one pays for a header, a peek and the streams to read it through — tens of microseconds —
 * so it is the count that bounds the work rather than the bytes.
 *
 * A release archive is a binary and a couple of text files. One with hundreds of files in front of
 * the binary is shipping what a deploy does nothing with, and is answered rather than walked.
 */
export const MAX_ENTRIES = 512;

export type Unwrapping =
  /** Not a zip at all, handed back with the bytes that were read to tell. */
  | { outcome: 'not-an-archive'; body: ReadableStream<Uint8Array> }
  | { outcome: 'unwrapped'; name: string; body: ReadableStream<Uint8Array> }
  | { outcome: 'no-executable' }
  | { outcome: 'walked-too-far' }
  | { outcome: 'entry-too-large' }
  | { outcome: 'unreadable' };

/**
 * What an archive this cannot follow is raised as, wherever it stops being followable — the walk
 * is also what feeds the executable onward, so one that goes wrong after the entry was found goes
 * wrong inside a stream somebody else is already reading.
 *
 * Everything a zip can do to this end arrives as this one error, a source that stopped part way
 * included: from here they are the same event, an archive that ended before it said it would.
 */
export class UnreadableArchiveError extends Error {
  constructor() {
    super('The zip ended before the entry it was describing.');
    this.name = 'UnreadableArchiveError';
  }
}

/**
 * What an entry too long for its own header to say so is raised as.
 *
 * A size field is four bytes, so a length that does not fit is written as all ones and kept in a
 * zip64 extra field instead. Nothing here reads that field: the length it holds starts at four
 * gibibytes, which is past what could be stored — and an entry whose length is unknown is one
 * there is no way to walk past to reach whatever follows it.
 */
export class EntryTooLargeError extends Error {
  constructor() {
    super('An entry declares a length only a zip64 field could hold.');
    this.name = 'EntryTooLargeError';
  }
}

/**
 * The executable inside a zip, or the bytes back where they are not one.
 *
 * It comes back once the entry has been found and its first bytes read, which is a name and a
 * body rather than the promise of one: everything before the executable has been walked past by
 * then, and only its own bytes are still to come.
 *
 * `maxSkippedBytes` bounds that walk. An archive is a claim about its own contents, and an entry
 * claiming a petabyte of text before the binary would otherwise be read until it ended.
 */
export async function unwrapExecutable({
  archive,
  maxSkippedBytes,
}: {
  archive: ReadableStream<Uint8Array>;
  maxSkippedBytes: number;
}): Promise<Unwrapping> {
  const bytes = queued(archive);
  const opening = await bytes.need(SIGNATURE_BYTES);
  if (opening === undefined || !opening.equals(LOCAL_HEADER)) {
    return { outcome: 'not-an-archive', body: bytes.rest() };
  }

  try {
    return await executableIn({ bytes, maxSkippedBytes });
  } catch (failure) {
    // Whatever went wrong, the archive is not going to be read any further, and a source nobody
    // is reading holds its connection open until it is let go of.
    await bytes.cancel();
    if (failure instanceof UnreadableArchiveError) {
      return { outcome: 'unreadable' };
    }
    if (failure instanceof EntryTooLargeError) {
      return { outcome: 'entry-too-large' };
    }
    throw failure;
  }
}

async function executableIn({
  bytes,
  maxSkippedBytes,
}: {
  bytes: Queued;
  maxSkippedBytes: number;
}): Promise<Unwrapping> {
  let skipped = 0;
  let entries = 0;

  while (skipped <= maxSkippedBytes && entries < MAX_ENTRIES) {
    const header = await readHeader(bytes);
    if (header.outcome !== 'entry') {
      await bytes.cancel();
      return header.outcome === 'end' ? { outcome: 'no-executable' } : { outcome: 'unreadable' };
    }

    // The headers count against the same budget as the data, and against a bound of their own:
    // an entry that declares nothing costs nothing to skip, so bytes alone never stop a walk.
    skipped += header.headerBytes;
    entries += 1;

    const data = entryData({ bytes, entry: header.entry });
    const content = readable({ entry: header.entry, data });
    const { head, body } = await peeked({ stream: content, count: ELF_MAGIC_LENGTH });
    if (isElfExecutable(head)) {
      return {
        outcome: 'unwrapped',
        name: named(header.entry.name),
        body: streamed(closing({ body, bytes })),
      };
    }
    skipped += await drained({ stream: body, budget: maxSkippedBytes - skipped });
  }

  await bytes.cancel();
  return { outcome: 'walked-too-far' };
}

type Entry = {
  name: string;
  flags: number;
  method: number;
  compressedSizeBytes: number;
};

type Header =
  | { outcome: 'entry'; entry: Entry; headerBytes: number }
  /** The central directory, which is where the entries stop and this walk is over. */
  | { outcome: 'end' }
  | { outcome: 'unreadable' };

async function readHeader(bytes: Queued): Promise<Header> {
  const fixed = await bytes.take(LOCAL_HEADER_BYTES);
  if (fixed === undefined) {
    return { outcome: 'unreadable' };
  }
  if (!fixed.subarray(0, SIGNATURE_BYTES).equals(LOCAL_HEADER)) {
    return { outcome: 'end' };
  }

  const nameBytes = fixed.readUInt16LE(NAME_LENGTH_AT);
  const extraBytes = fixed.readUInt16LE(EXTRA_LENGTH_AT);
  const name = await bytes.take(nameBytes);
  const extra = await bytes.take(extraBytes);
  if (name === undefined || extra === undefined) {
    return { outcome: 'unreadable' };
  }

  return {
    outcome: 'entry',
    headerBytes: LOCAL_HEADER_BYTES + nameBytes + extraBytes,
    entry: {
      name: name.toString('utf8'),
      flags: fixed.readUInt16LE(FLAGS_AT),
      method: fixed.readUInt16LE(METHOD_AT),
      compressedSizeBytes: fixed.readUInt32LE(COMPRESSED_SIZE_AT),
    },
  };
}

/**
 * The entry as bytes to read. Deflate is inflated and everything else is taken as it lies: stored
 * entries are already what they are, and an entry behind a password or in a compression nobody
 * ships a release in reads as bytes that are not an executable — which is the same verdict as any
 * other entry that is not the one being looked for.
 */
function readable({
  entry,
  data,
}: {
  entry: Entry;
  data: AsyncGenerator<Uint8Array>;
}): ReadableStream<Uint8Array> {
  const deflated = entry.method === METHOD_DEFLATE && (entry.flags & FLAG_ENCRYPTED) === 0;
  return streamed(deflated ? inflated(data) : data);
}

/** Whatever the compressed bytes turn out to be, including that they were not deflate at all. */
async function* inflated(data: AsyncGenerator<Uint8Array>): AsyncGenerator<Uint8Array> {
  const engine = createInflateRaw();
  const compressed = Readable.from(data);
  // Piping does not carry a failure the other way, and the source failing is the ordinary way
  // this ends: an archive that stopped part way has to stop the inflate reading it.
  compressed.on('error', (failure) => engine.destroy(failure));
  compressed.pipe(engine);

  try {
    yield* engine;
  } catch (failure) {
    // Everything but the source running out of what it was allowed to send: that is a verdict on
    // the bytes rather than on the archive, and the only one this is not entitled to restate.
    throw failure instanceof ArtifactTooLargeError ? failure : new UnreadableArchiveError();
  }
}

/**
 * The executable's bytes, and the source let go of after the last of them. What follows the entry
 * is the rest of the archive's own bookkeeping, which nothing here reads.
 */
async function* closing({
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

/** The entry's own name, which is the last segment where the archive kept it in a directory. */
function named(path: string): string {
  return path.split(PATH_SEPARATOR).at(-1) ?? path;
}

function entryData({ bytes, entry }: { bytes: Queued; entry: Entry }): AsyncGenerator<Uint8Array> {
  return (entry.flags & FLAG_SIZES_IN_DESCRIPTOR) === 0
    ? ofDeclaredSize({ bytes, sizeBytes: entry.compressedSizeBytes })
    : untilDescriptor(bytes);
}

async function* ofDeclaredSize({
  bytes,
  sizeBytes,
}: {
  bytes: Queued;
  sizeBytes: number;
}): AsyncGenerator<Uint8Array> {
  if (sizeBytes === SIZE_IN_ZIP64_EXTRA) {
    throw new EntryTooLargeError();
  }
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

/**
 * The entry's data, up to the descriptor that follows it.
 *
 * The descriptor is found rather than jumped to: an entry written this way says its length only
 * after the data, and says it in any of four shapes. So it is looked for the other way round —
 * from the record that follows every entry, back through whichever shape sits in front of that
 * record and agrees on how far it is from the start. Data that happens to spell a signature does
 * not also happen to spell the distance to itself.
 *
 * Nothing is handed on until it is past the window a descriptor and that record could still be
 * sitting in, so what comes out is the entry's data and never anything written after it.
 */
async function* untilDescriptor(bytes: Queued): AsyncGenerator<Uint8Array> {
  let emitted = 0;

  while (true) {
    const held = await bytes.holding();
    const ending = endingIn({ held, emitted });
    if (ending !== undefined) {
      if (ending.at > 0) {
        yield held.subarray(0, ending.at);
      }
      bytes.drop(ending.at + ending.descriptorBytes);
      return;
    }

    const safe = held.length - HELD_BACK_BYTES;
    if (safe > 0) {
      yield held.subarray(0, safe);
      bytes.drop(safe);
      emitted += safe;
    }
    if (!(await bytes.more())) {
      throw new UnreadableArchiveError();
    }
  }
}

/** Where the entry's data ends, and how much the descriptor saying so took to say it. */
type Ending = { at: number; descriptorBytes: number };

function endingIn({ held, emitted }: { held: Buffer; emitted: number }): Ending | undefined {
  let from = 0;

  while (true) {
    const follows = followingRecordIn({ held, from });
    if (follows === undefined) {
      return undefined;
    }
    const ending = endingBefore({ held, follows, emitted });
    if (ending !== undefined) {
      return ending;
    }
    from = follows + 1;
  }
}

/** The first record in hand that an entry could be followed by, which is where to look back from. */
function followingRecordIn({ held, from }: { held: Buffer; from: number }): number | undefined {
  const found = FOLLOWING_RECORDS.map((record) => held.indexOf(record, from)).filter(
    (at) => at >= 0,
  );
  return found.length === 0 ? undefined : Math.min(...found);
}

/** The descriptor immediately in front of `follows`, as the shape that agrees it belongs there. */
function endingBefore({
  held,
  follows,
  emitted,
}: {
  held: Buffer;
  follows: number;
  emitted: number;
}): Ending | undefined {
  for (const shape of DESCRIPTOR_SHAPES) {
    const at = follows - shape.totalBytes;
    if (at < 0 || !isDescriptor({ held, at, shape })) {
      continue;
    }
    if (claimedSize({ held, at, shape }) === emitted + at) {
      return { at, descriptorBytes: shape.totalBytes };
    }
  }
  return undefined;
}

/** A shape that carries the signature has to be showing it; the other two are read on faith. */
function isDescriptor({
  held,
  at,
  shape,
}: {
  held: Buffer;
  at: number;
  shape: DescriptorShape;
}): boolean {
  return !shape.signed || held.subarray(at, at + SIGNATURE_BYTES).equals(DATA_DESCRIPTOR);
}

/** What the descriptor says the data in front of it came to, read at its own shape's width. */
function claimedSize({
  held,
  at,
  shape,
}: {
  held: Buffer;
  at: number;
  shape: DescriptorShape;
}): number {
  const size = at + shape.compressedSizeAt;
  return shape.sizeBytes === ZIP64_SIZE_BYTES
    ? Number(held.readBigUInt64LE(size))
    : held.readUInt32LE(size);
}

/** The stream's first bytes, and the stream itself with them still in front of it. */
async function peeked({
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
async function drained({
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
type Queued = {
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

function queued(source: ReadableStream<Uint8Array>): Queued {
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
function streamed(source: AsyncGenerator<Uint8Array>): ReadableStream<Uint8Array> {
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
