// A zip read the only way a fetch can read one: forwards, once, with a chunk in hand.
//
// The index a zip is meant to be opened by sits at its end, which is behind the bytes as they
// arrive — so nothing here uses it. Each entry is taken from the header that precedes its data
// instead, and the executable is whichever entry's first bytes say it is one. A release archive
// is a binary and a couple of text files, so that is a walk of two or three entries.

import { Buffer } from 'node:buffer';
import { createInflateRaw } from 'node:zlib';
import {
  closing,
  decompressed,
  drained,
  ofSize,
  peeked,
  type Queued,
  streamed,
} from '#lib/archive/bytes.ts';
import {
  EntryTooLargeError,
  MAX_ENTRIES,
  UnreadableArchiveError,
  type Unwrapping,
} from '#lib/archive/walk.ts';
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

/** What a size field says when the real one is in a zip64 extra field beside it. */
const SIZE_IN_ZIP64_EXTRA = 0xff_ff_ff_ff;

const ZIP64_EXTRA_ID = 0x0001;
const EXTRA_HEADER_BYTES = 4;
const EXTRA_BYTES_AT = 2;
/**
 * Where the compressed length sits in that field. A local header's copy carries both lengths and
 * carries them in one order — uncompressed, then compressed — so there is nothing to work out:
 * the two that follow in a directory's copy are the ones a directory has and this does not.
 */
const ZIP64_COMPRESSED_SIZE_AT = 8;
const ZIP64_SIZES_BYTES = 16;

const PATH_SEPARATOR = '/';

/** What a zip opens with, which is the only thing that says it is one before the index at its end. */
export const ZIP_MAGIC = LOCAL_HEADER;

/**
 * The executable inside a zip, walked to from the front.
 *
 * It comes back once the entry has been found and its first bytes read, which is a name and a body
 * rather than the promise of one: everything before the executable has been walked past by then,
 * and only its own bytes are still to come.
 */
export async function executableInZip({
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
      compressedSizeBytes: compressedSizeOf({ fixed, extra }),
    },
  };
}

/**
 * How long the entry's data is, from the zip64 field where the header could only point at one.
 *
 * Four bytes cannot hold a length past four gibibytes, so a writer with one — or one that writes
 * zip64 whatever the length, as some do — leaves all ones in the header and the real number in a
 * field beside it. Reading it is the difference between walking past such an entry and refusing
 * the archive that carries it.
 */
function compressedSizeOf({ fixed, extra }: { fixed: Buffer; extra: Buffer }): number {
  const declared = fixed.readUInt32LE(COMPRESSED_SIZE_AT);
  if (declared !== SIZE_IN_ZIP64_EXTRA) {
    return declared;
  }
  const sizes = zip64SizesIn(extra);
  // Left as the sentinel where the header pointed at a field that is not there, which is a length
  // nothing here can know and `ofDeclaredSize` answers as such.
  return sizes === undefined
    ? SIZE_IN_ZIP64_EXTRA
    : Number(sizes.readBigUInt64LE(ZIP64_COMPRESSED_SIZE_AT));
}

/** The zip64 field among whatever else the header carried, where it is there and holds both sizes. */
function zip64SizesIn(extra: Buffer): Buffer | undefined {
  let at = 0;

  while (at + EXTRA_HEADER_BYTES <= extra.length) {
    const blockBytes = extra.readUInt16LE(at + EXTRA_BYTES_AT);
    const data = extra.subarray(at + EXTRA_HEADER_BYTES, at + EXTRA_HEADER_BYTES + blockBytes);
    if (extra.readUInt16LE(at) === ZIP64_EXTRA_ID && data.length >= ZIP64_SIZES_BYTES) {
      return data;
    }
    at += EXTRA_HEADER_BYTES + blockBytes;
  }

  return undefined;
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
  return streamed(deflated ? decompressed({ engine: createInflateRaw(), data }) : data);
}

/** The entry's own name, which is the last segment where the archive kept it in a directory. */
function named(path: string): string {
  return path.split(PATH_SEPARATOR).at(-1) ?? path;
}

/** The entry's data, refused where its length was one the header could only point at. */
function ofDeclaredSize({
  bytes,
  sizeBytes,
}: {
  bytes: Queued;
  sizeBytes: number;
}): AsyncGenerator<Uint8Array> {
  if (sizeBytes === SIZE_IN_ZIP64_EXTRA) {
    throw new EntryTooLargeError();
  }
  return ofSize({ bytes, sizeBytes });
}

function entryData({ bytes, entry }: { bytes: Queued; entry: Entry }): AsyncGenerator<Uint8Array> {
  return (entry.flags & FLAG_SIZES_IN_DESCRIPTOR) === 0
    ? ofDeclaredSize({ bytes, sizeBytes: entry.compressedSizeBytes })
    : untilDescriptor(bytes);
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
