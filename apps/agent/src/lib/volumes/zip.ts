// A zip read from the index at its end, which is the way a zip is meant to be read.
//
// The host has the whole archive on disk before it unpacks any of it, and that is the difference
// from the reader in `apps/api/src/lib/archive/zip.ts`: that one reads a fetch — forwards, once —
// so it can never reach the index, and has to hunt backwards through the stream for lengths an
// entry is allowed to declare only after its own data. Here every path, length, mode and offset is
// read from the central directory outright, and read before a single byte is written.
//
// What that buys is not only simplicity. The whole listing is in hand at the start, so entries can
// be handed over in an order the containment check in `seed.ts` is sound against, and a name that
// appears twice is answered rather than raced.

import { Buffer } from 'node:buffer';
import {
  type ArchiveEntry,
  type ArchiveEntryKind,
  UnreadableArchive,
} from '#lib/volumes/archive.ts';

const SIGNATURE_BYTES = 4;

function signature(bytes: string): Buffer {
  return Buffer.from(bytes, 'latin1');
}

const LOCAL_HEADER = signature('PK\x03\x04');
const DIRECTORY_HEADER = signature('PK\x01\x02');
const DIRECTORY_END = signature('PK\x05\x06');
const ZIP64_LOCATOR = signature('PK\x06\x07');
const ZIP64_DIRECTORY_END = signature('PK\x06\x06');

/** What a zip opens with, which is the whole of what says a file is one before its index is read. */
export const ZIP_MAGIC = LOCAL_HEADER;

const DIRECTORY_END_BYTES = 22;
const END_ENTRIES_AT = 10;
const END_DIRECTORY_BYTES_AT = 12;
const END_DIRECTORY_AT = 16;
const END_COMMENT_LENGTH_AT = 20;

/**
 * The comment a zip may end with, which is why the record in front of it is searched for rather
 * than read: nothing says how far from the end it sits except its own account of what follows it.
 */
const MAX_COMMENT_BYTES = 65_535;

const ZIP64_LOCATOR_BYTES = 20;
const ZIP64_LOCATOR_END_AT = 8;
const ZIP64_DIRECTORY_END_BYTES = 56;
const ZIP64_END_ENTRIES_AT = 32;
const ZIP64_END_DIRECTORY_BYTES_AT = 40;
const ZIP64_END_DIRECTORY_AT = 48;

const DIRECTORY_HEADER_BYTES = 46;
const MADE_BY_AT = 4;
const FLAGS_AT = 8;
const METHOD_AT = 10;
const COMPRESSED_SIZE_AT = 20;
const SIZE_AT = 24;
const NAME_LENGTH_AT = 28;
const EXTRA_LENGTH_AT = 30;
const COMMENT_LENGTH_AT = 32;
const EXTERNAL_ATTRIBUTES_AT = 38;
const HEADER_OFFSET_AT = 42;

const LOCAL_HEADER_BYTES = 30;
const LOCAL_NAME_LENGTH_AT = 26;
const LOCAL_EXTRA_LENGTH_AT = 28;

/** What a field says when the real number is in a zip64 record or field beside it. */
const IN_ZIP64 = 0xff_ff_ff_ff;
const COUNT_IN_ZIP64 = 0xff_ff;

const ZIP64_EXTRA_ID = 0x0001;
const EXTRA_ID_AT = 0;
const EXTRA_BYTES_AT = 2;
const EXTRA_HEADER_BYTES = 4;
const ZIP64_FIELD_BYTES = 8;

const FLAG_ENCRYPTED = 0x01;
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;
const DEFLATE_RAW = 'deflate-raw';

/** Where a unix zip keeps the mode, and what says it is one: `version made by`, as the host it ran on. */
const MADE_BY_UNIX = 3;
const MADE_BY_SHIFT = 8;
const ATTRIBUTES_MODE_SHIFT = 16;

const FILE_TYPE_MASK = 0xf000;
const FILE_TYPE_SYMLINK = 0xa000;
const FILE_TYPE_DIRECTORY = 0x4000;
const FILE_TYPE_REGULAR = 0x8000;
/** No type bits at all, which some writers leave when they store permissions and nothing else. */
const FILE_TYPE_UNSAID = 0;

const PERMISSION_BITS = 0o777;

/**
 * What an entry is given where the archive did not say.
 *
 * A zip made anywhere but unix carries dos attribute bits where a mode would be, so there is
 * nothing to preserve and these are what a freshly written file and directory would have.
 */
const DEFAULT_FILE_MODE = 0o644;
const DEFAULT_DIRECTORY_MODE = 0o755;

const PATH_SEPARATOR = '/';

const BYTES_PER_MIB = 1_048_576;
const MAX_DIRECTORY_MIB = 64;

/**
 * As much of the index as will be held.
 *
 * The whole of it is read at once, which is what buys everything above — so it is also the one
 * allocation here whose size the archive gets to choose. A gibibyte of upload could be a gibibyte
 * of index and nothing else, where a tarball's headers are only ever a block at a time.
 *
 * Far above any archive the unpack would go on to accept. `SEED_LIMITS` in `seed.ts` stops at two
 * hundred thousand entries, and an entry costs forty-six bytes of index plus its own path, so one
 * at that ceiling comes to tens of megabytes. Nothing compares the two and nothing needs to: that
 * bound is on the filesystem an archive becomes, and this one is on the memory reading it costs.
 */
const MAX_DIRECTORY_BYTES = MAX_DIRECTORY_MIB * BYTES_PER_MIB;

/**
 * As much of a symlink's target as will be read.
 *
 * A target is a path and no filesystem takes one longer than this, where the entry carrying it may
 * declare itself as large as the archive. It is read before the entry is handed over — the unpack
 * decides whether a link may be written from where it points — so this is the bound that applies,
 * not the one on the unpack.
 */
const MAX_LINK_TARGET_BYTES = 4096;

/** An entry as the index describes it, which is everything about it but its bytes. */
type IndexedEntry = {
  readonly path: string;
  readonly kind: ArchiveEntryKind;
  readonly mode: number;
  readonly sizeBytes: number;
  readonly compressedSizeBytes: number;
  readonly headerAt: number;
  readonly stored: boolean;
};

/** Where the index is and how much of it there is, from whichever record turned out to say so. */
type DirectoryBounds = {
  readonly entries: number;
  readonly directoryAt: number;
  readonly directoryBytes: number;
};

/** The three the header may hand to a zip64 field, in the order such a field writes them. */
const MEASURED_IN_ORDER = ['sizeBytes', 'compressedSizeBytes', 'headerAt'] as const;
type Measured = Record<(typeof MEASURED_IN_ORDER)[number], number>;

/**
 * Every entry in the archive, in an order a walk can trust.
 *
 * Unlike a tarball's, an entry's bytes are readable whenever they are asked for: each one is its
 * own compressed run at its own offset, so nothing here is spent by being walked past.
 */
export async function* zipEntries(archivePath: string): AsyncGenerator<ArchiveEntry> {
  const file = Bun.file(archivePath);
  for (const entry of await indexIn(file)) {
    yield {
      path: entry.path,
      kind: entry.kind,
      mode: entry.mode,
      sizeBytes: entry.sizeBytes,
      linkTarget: entry.kind === 'symlink' ? await linkTargetOf({ file, entry }) : '',
      content: () => contentOf({ file, entry }),
    };
  }
}

async function indexIn(file: Bun.BunFile): Promise<readonly IndexedEntry[]> {
  const bounds = await boundsOf(file);
  if (bounds.directoryBytes > MAX_DIRECTORY_BYTES) {
    throw new UnreadableArchive('has an index larger than one an app could be seeded from');
  }
  const directory = await bytesAt({
    file,
    at: bounds.directoryAt,
    length: bounds.directoryBytes,
  });

  const entries: IndexedEntry[] = [];
  let at = 0;
  for (let read = 0; read < bounds.entries; read += 1) {
    const parsed = entryIn({ directory, at });
    entries.push(parsed.entry);
    at = parsed.next;
  }
  return inOrder(entries);
}

/**
 * Every entry, each named once, ordered so that nothing arrives before what contains it.
 *
 * The index is in whatever order the writer chose. The unpack judges a symlink as it passes one,
 * and refuses anything underneath one it has already seen — so an entry that reached the walk
 * before the link above it would be written through a link nobody had judged. Sorting by path
 * settles that for good: a path is a prefix of everything below it, so it sorts in front of all of
 * them. It costs one pass over a listing that is already in memory.
 *
 * A path that appears twice ends the read rather than being resolved. Extractors keep the last such
 * entry, so a second one under a name somebody has already read is a way for an archive to be
 * reviewed as one thing and unpacked as another.
 */
function inOrder(entries: readonly IndexedEntry[]): readonly IndexedEntry[] {
  const byPath = new Map<string, IndexedEntry>();
  for (const entry of entries) {
    if (byPath.has(entry.path)) {
      throw new UnreadableArchive('names the same path twice');
    }
    byPath.set(entry.path, entry);
  }

  const ordered: IndexedEntry[] = [];
  for (const path of [...byPath.keys()].sort()) {
    const entry = byPath.get(path);
    if (entry !== undefined) {
      ordered.push(entry);
    }
  }
  return ordered;
}

async function boundsOf(file: Bun.BunFile): Promise<DirectoryBounds> {
  const tailBytes = Math.min(file.size, DIRECTORY_END_BYTES + MAX_COMMENT_BYTES);
  const tail = await bytesAt({ file, at: file.size - tailBytes, length: tailBytes });
  const at = directoryEndIn(tail);
  if (at === undefined) {
    throw new UnreadableArchive('does not end with the index a zip is read from');
  }

  const bounds = {
    entries: tail.readUInt16LE(at + END_ENTRIES_AT),
    directoryBytes: tail.readUInt32LE(at + END_DIRECTORY_BYTES_AT),
    directoryAt: tail.readUInt32LE(at + END_DIRECTORY_AT),
  };
  return heldInZip64(bounds) ? await zip64BoundsOf({ file, tail, at }) : bounds;
}

/**
 * The record that says where the index is, found from the end.
 *
 * Searched backwards and taken only where its own account of the comment behind it reaches exactly
 * the end of the file: a zip whose comment happens to spell the signature would otherwise be read
 * from the wrong place, and a comment is a field somebody uploading an archive controls.
 */
function directoryEndIn(tail: Buffer): number | undefined {
  for (let at = tail.length - DIRECTORY_END_BYTES; at >= 0; at -= 1) {
    const isRecord =
      tail.subarray(at, at + SIGNATURE_BYTES).equals(DIRECTORY_END) &&
      tail.readUInt16LE(at + END_COMMENT_LENGTH_AT) === tail.length - at - DIRECTORY_END_BYTES;
    if (isRecord) {
      return at;
    }
  }
  return undefined;
}

function heldInZip64(bounds: DirectoryBounds): boolean {
  return (
    bounds.entries === COUNT_IN_ZIP64 ||
    bounds.directoryBytes === IN_ZIP64 ||
    bounds.directoryAt === IN_ZIP64
  );
}

/**
 * The same three, at the width zip64 writes them.
 *
 * Reached through the locator that sits immediately in front of the record that deferred to it, so
 * this never searches: an archive claiming a zip64 index and not carrying the locator is one whose
 * index nothing can find.
 */
async function zip64BoundsOf({
  file,
  tail,
  at,
}: {
  file: Bun.BunFile;
  tail: Buffer;
  at: number;
}): Promise<DirectoryBounds> {
  const locatorAt = at - ZIP64_LOCATOR_BYTES;
  const located =
    locatorAt >= 0 && tail.subarray(locatorAt, locatorAt + SIGNATURE_BYTES).equals(ZIP64_LOCATOR);
  if (!located) {
    throw new UnreadableArchive('says its index is a zip64 one and does not say where it is');
  }

  const record = await bytesAt({
    file,
    at: Number(tail.readBigUInt64LE(locatorAt + ZIP64_LOCATOR_END_AT)),
    length: ZIP64_DIRECTORY_END_BYTES,
  });
  if (!record.subarray(0, SIGNATURE_BYTES).equals(ZIP64_DIRECTORY_END)) {
    throw new UnreadableArchive('points at a zip64 index record that is not one');
  }
  return {
    entries: Number(record.readBigUInt64LE(ZIP64_END_ENTRIES_AT)),
    directoryBytes: Number(record.readBigUInt64LE(ZIP64_END_DIRECTORY_BYTES_AT)),
    directoryAt: Number(record.readBigUInt64LE(ZIP64_END_DIRECTORY_AT)),
  };
}

type ParsedEntry = { readonly entry: IndexedEntry; readonly next: number };

function entryIn({ directory, at }: { directory: Buffer; at: number }): ParsedEntry {
  const readable =
    at + DIRECTORY_HEADER_BYTES <= directory.length &&
    directory.subarray(at, at + SIGNATURE_BYTES).equals(DIRECTORY_HEADER);
  if (!readable) {
    throw new UnreadableArchive('has an index that stops describing entries part way through');
  }

  const fixed = directory.subarray(at, at + DIRECTORY_HEADER_BYTES);
  const nameBytes = fixed.readUInt16LE(NAME_LENGTH_AT);
  const extraBytes = fixed.readUInt16LE(EXTRA_LENGTH_AT);
  const nameAt = at + DIRECTORY_HEADER_BYTES;
  const extraAt = nameAt + nameBytes;
  const name = directory.subarray(nameAt, extraAt).toString('utf8');
  const measured = measuredIn({ fixed, extra: directory.subarray(extraAt, extraAt + extraBytes) });

  return {
    entry: {
      path: name,
      ...describedBy({ fixed, name }),
      sizeBytes: measured.sizeBytes,
      compressedSizeBytes: measured.compressedSizeBytes,
      headerAt: measured.headerAt,
      stored: methodOf(fixed) === METHOD_STORED,
    },
    next: extraAt + extraBytes + fixed.readUInt16LE(COMMENT_LENGTH_AT),
  };
}

/**
 * How the entry is compressed, or the end of the read where it is in a way this does not undo.
 *
 * An entry behind a password is refused here rather than written as the ciphertext it would
 * otherwise unpack to, which is a file an app would find and never be able to use.
 */
function methodOf(fixed: Buffer): number {
  if ((fixed.readUInt16LE(FLAGS_AT) & FLAG_ENCRYPTED) !== 0) {
    throw new UnreadableArchive('holds an entry behind a password');
  }
  const method = fixed.readUInt16LE(METHOD_AT);
  if (method !== METHOD_STORED && method !== METHOD_DEFLATED) {
    throw new UnreadableArchive('holds an entry compressed in a way nibrun does not read');
  }
  return method;
}

/**
 * The two lengths and the offset, from the zip64 field wherever the header could only point at one.
 *
 * The field carries only those of the three whose own header field is all ones, and carries them in
 * a fixed order — so which of them sits where is decided by which sentinels the header is showing.
 * Reading it any other way puts an offset where a length should be.
 */
function measuredIn({ fixed, extra }: { fixed: Buffer; extra: Buffer }): Measured {
  const declared: Measured = {
    sizeBytes: fixed.readUInt32LE(SIZE_AT),
    compressedSizeBytes: fixed.readUInt32LE(COMPRESSED_SIZE_AT),
    headerAt: fixed.readUInt32LE(HEADER_OFFSET_AT),
  };
  const deferred = MEASURED_IN_ORDER.filter((name) => declared[name] === IN_ZIP64);
  if (deferred.length === 0) {
    return declared;
  }

  const field = zip64FieldIn(extra);
  if (field === undefined || field.length < deferred.length * ZIP64_FIELD_BYTES) {
    throw new UnreadableArchive('declares a number it does not carry the zip64 field for');
  }
  const measured = { ...declared };
  for (const [index, name] of deferred.entries()) {
    measured[name] = Number(field.readBigUInt64LE(index * ZIP64_FIELD_BYTES));
  }
  return measured;
}

function zip64FieldIn(extra: Buffer): Buffer | undefined {
  let at = 0;
  while (at + EXTRA_HEADER_BYTES <= extra.length) {
    const bytes = extra.readUInt16LE(at + EXTRA_BYTES_AT);
    if (extra.readUInt16LE(at + EXTRA_ID_AT) === ZIP64_EXTRA_ID) {
      return extra.subarray(at + EXTRA_HEADER_BYTES, at + EXTRA_HEADER_BYTES + bytes);
    }
    at += EXTRA_HEADER_BYTES + bytes;
  }
  return undefined;
}

/**
 * What the entry is and what it may be, from the mode where the archive carries one.
 *
 * It carries one only when it was made on unix, which `version made by` is what says: the same four
 * bytes are dos attribute bits everywhere else, and reading those as a mode would be inventing
 * permissions out of whether somebody's file was marked read-only. So a zip made on Windows, or by
 * a browser, or by Finder, has no permissions in it at all, and an executable bit cannot survive
 * one — there is nothing in the archive that could carry it.
 */
function describedBy({ fixed, name }: { fixed: Buffer; name: string }): {
  kind: ArchiveEntryKind;
  mode: number;
} {
  const named = name.endsWith(PATH_SEPARATOR);
  const unixMode = unixModeIn(fixed);
  if (unixMode === undefined) {
    return named
      ? { kind: 'directory', mode: DEFAULT_DIRECTORY_MODE }
      : { kind: 'file', mode: DEFAULT_FILE_MODE };
  }
  return { kind: kindOf({ unixMode, named }), mode: unixMode & PERMISSION_BITS };
}

function unixModeIn(fixed: Buffer): number | undefined {
  if (fixed.readUInt16LE(MADE_BY_AT) >> MADE_BY_SHIFT !== MADE_BY_UNIX) {
    return undefined;
  }
  // Unix in one field and nothing in the other is a writer that filled in the first and not the
  // second, which says no more about the entry than a zip made anywhere else does.
  const mode = fixed.readUInt32LE(EXTERNAL_ATTRIBUTES_AT) >>> ATTRIBUTES_MODE_SHIFT;
  return mode === 0 ? undefined : mode;
}

function kindOf({ unixMode, named }: { unixMode: number; named: boolean }): ArchiveEntryKind {
  const type = unixMode & FILE_TYPE_MASK;
  if (type === FILE_TYPE_SYMLINK) {
    return 'symlink';
  }
  if (type === FILE_TYPE_DIRECTORY || named) {
    return 'directory';
  }
  return type === FILE_TYPE_REGULAR || type === FILE_TYPE_UNSAID ? 'file' : 'unsupported';
}

/**
 * Where a symlink points, which a zip writes as the entry's own bytes rather than in a header.
 *
 * Read before the entry is handed over, because what the unpack does with a link is decide from its
 * target whether to write it at all — and it decides that of an entry it has in hand.
 */
async function linkTargetOf({
  file,
  entry,
}: {
  file: Bun.BunFile;
  entry: IndexedEntry;
}): Promise<string> {
  if (entry.sizeBytes > MAX_LINK_TARGET_BYTES) {
    throw new UnreadableArchive('holds a symlink pointing somewhere no filesystem would take');
  }
  const pieces: Buffer[] = [];
  for await (const piece of contentOf({ file, entry })) {
    pieces.push(Buffer.from(piece));
  }
  return Buffer.concat(pieces).toString('utf8');
}

/**
 * The entry's own bytes, cut at the length the index declared.
 *
 * Cut rather than trusted: what a stream of deflate expands to is decided by the stream, and the
 * length the unpack measured the archive against is this one. An entry that ends early ends the
 * read — a short file is a seed that quietly differs from what was uploaded.
 *
 * Nothing checks the entry's crc. The archive's own digest was proved against what the api recorded
 * before any of this was opened, so a per-entry checksum would be answering a question that has
 * already been answered about every byte here.
 */
async function* contentOf({
  file,
  entry,
}: {
  file: Bun.BunFile;
  entry: IndexedEntry;
}): AsyncGenerator<Uint8Array> {
  const at = await dataOffsetOf({ file, entry });
  const compressed = file.slice(at, at + entry.compressedSizeBytes).stream();
  const data = entry.stored
    ? compressed
    : compressed.pipeThrough(new DecompressionStream(DEFLATE_RAW));

  let held = 0;
  for await (const chunk of data) {
    const wanted = chunk.subarray(0, entry.sizeBytes - held);
    held += wanted.length;
    if (wanted.length > 0) {
      yield wanted;
    }
    if (held === entry.sizeBytes) {
      return;
    }
  }
  if (held < entry.sizeBytes) {
    throw new UnreadableArchive('holds an entry shorter than it said it was');
  }
}

/**
 * Where the entry's bytes begin, from its own local header rather than from the index.
 *
 * The two headers carry different extra fields — a local one may hold a timestamp the index does
 * not — so how far past the header the data sits is something only the header itself can say.
 */
async function dataOffsetOf({
  file,
  entry,
}: {
  file: Bun.BunFile;
  entry: IndexedEntry;
}): Promise<number> {
  const header = await bytesAt({ file, at: entry.headerAt, length: LOCAL_HEADER_BYTES });
  if (!header.subarray(0, SIGNATURE_BYTES).equals(LOCAL_HEADER)) {
    throw new UnreadableArchive('has an index pointing where no entry begins');
  }
  return (
    entry.headerAt +
    LOCAL_HEADER_BYTES +
    header.readUInt16LE(LOCAL_NAME_LENGTH_AT) +
    header.readUInt16LE(LOCAL_EXTRA_LENGTH_AT)
  );
}

async function bytesAt({
  file,
  at,
  length,
}: {
  file: Bun.BunFile;
  at: number;
  length: number;
}): Promise<Buffer> {
  if (at < 0) {
    throw new UnreadableArchive('is smaller than the records it would have to carry');
  }
  const read = Buffer.from(await file.slice(at, at + length).arrayBuffer());
  if (read.length < length) {
    throw new UnreadableArchive('ends before its own index says it does');
  }
  return read;
}
