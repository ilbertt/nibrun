import { Buffer } from 'node:buffer';

/**
 * Zips written record by record, for the same reason the tarballs beside them are: the archives
 * worth reading against are the ones no zip writer will produce — an entry behind a password, a
 * path named twice, a length the entry does not hold. A real `zip` is used beside these for the
 * shapes it does write.
 */

function signature(bytes: string): Buffer {
  return Buffer.from(bytes, 'latin1');
}

const LOCAL_SIGNATURE = signature('PK\x03\x04');
const DIRECTORY_SIGNATURE = signature('PK\x01\x02');
const DIRECTORY_END_SIGNATURE = signature('PK\x05\x06');
const ZIP64_DIRECTORY_END_SIGNATURE = signature('PK\x06\x06');
const ZIP64_LOCATOR_SIGNATURE = signature('PK\x06\x07');

const LOCAL_HEADER_BYTES = 30;
const LOCAL_VERSION_AT = 4;
const LOCAL_FLAGS_AT = 6;
const LOCAL_METHOD_AT = 8;
const LOCAL_CRC_AT = 14;
const LOCAL_COMPRESSED_SIZE_AT = 18;
const LOCAL_SIZE_AT = 22;
const LOCAL_NAME_LENGTH_AT = 26;

const DIRECTORY_HEADER_BYTES = 46;
const MADE_BY_AT = 4;
const VERSION_NEEDED_AT = 6;
const FLAGS_AT = 8;
const METHOD_AT = 10;
const CRC_AT = 16;
const COMPRESSED_SIZE_AT = 20;
const SIZE_AT = 24;
const NAME_LENGTH_AT = 28;
const EXTRA_LENGTH_AT = 30;
const EXTERNAL_ATTRIBUTES_AT = 38;
const HEADER_OFFSET_AT = 42;

const DIRECTORY_END_BYTES = 22;
const END_ENTRIES_HERE_AT = 8;
const END_ENTRIES_AT = 10;
const END_DIRECTORY_BYTES_AT = 12;
const END_DIRECTORY_AT = 16;
const END_COMMENT_LENGTH_AT = 20;

const ZIP64_DIRECTORY_END_BYTES = 56;
/** The record's own length, counted from the field after the one that states it. */
const ZIP64_END_SIZE_AT = 4;
const ZIP64_END_SIZE_FROM = 12;
const ZIP64_END_ENTRIES_HERE_AT = 24;
const ZIP64_END_ENTRIES_AT = 32;
const ZIP64_END_DIRECTORY_BYTES_AT = 40;
const ZIP64_END_DIRECTORY_AT = 48;

const ZIP64_LOCATOR_BYTES = 20;
const ZIP64_LOCATOR_END_AT = 8;
const ZIP64_LOCATOR_DISKS_AT = 16;
const ONE_DISK = 1;

const ZIP64_EXTRA_ID = 0x0001;
const EXTRA_ID_AT = 0;
const EXTRA_BYTES_AT = 2;
const EXTRA_HEADER_BYTES = 4;
const ZIP64_SIZES_BYTES = 16;
const ZIP64_SIZE_AT = 4;
const ZIP64_COMPRESSED_SIZE_AT = 12;

const IN_ZIP64 = 0xff_ff_ff_ff;
const COUNT_IN_ZIP64 = 0xff_ff;

const VERSION = 20;

export const METHOD_STORED = 0;
export const METHOD_DEFLATED = 8;
/** Bzip2, which is a real method and one nibrun does not undo. */
export const METHOD_BZIP2 = 12;

export const FLAG_ENCRYPTED = 0x01;

export const UNIX_FILE = 0o100_000;
export const UNIX_DIRECTORY = 0o040_000;
export const UNIX_SYMLINK = 0o120_000;
export const UNIX_FIFO = 0o010_000;

const MADE_BY_SHIFT = 8;
const MADE_BY_UNIX = 3 << MADE_BY_SHIFT;
/** What a zip made on Windows says, which is the case that carries no mode at all. */
const MADE_BY_DOS = 0;
const ATTRIBUTES_MODE_SHIFT = 16;

const DEFAULT_MODE = 0o644;
const NOTHING = 0;

export type ZipEntry = {
  path: string;
  body?: string;
  /** Permissions, where the archive carries a unix mode at all. */
  mode?: number;
  /** The type bits beside them. A plain file unless said otherwise. */
  unixType?: number;
  /** A zip made anywhere but unix, which puts dos attribute bits where a mode would be. */
  dos?: boolean;
  /** Unix in the header and nothing in the attributes, as some writers leave it. */
  noAttributes?: boolean;
  method?: number;
  flags?: number;
  /** What the index says the entry is, where that is not what it holds. */
  declaredSize?: number;
  /** Sizes written all-ones with the real ones in a zip64 field, as some writers always do. */
  zip64Sizes?: boolean;
};

type Placed = {
  entry: ZipEntry;
  data: Buffer;
  crc: number;
  sizeBytes: number;
  headerAt: number;
};

type Declared = { sizeBytes: number; compressedSizeBytes: number };

function dataFor(entry: ZipEntry): Buffer {
  const body = Buffer.from(entry.body ?? '', 'utf8');
  return (entry.method ?? METHOD_DEFLATED) === METHOD_DEFLATED
    ? Buffer.from(Bun.deflateSync(new Uint8Array(body)))
    : body;
}

function externalAttributesOf(entry: ZipEntry): number {
  if (entry.dos === true || entry.noAttributes === true) {
    return NOTHING;
  }
  const mode = (entry.unixType ?? UNIX_FILE) | (entry.mode ?? DEFAULT_MODE);
  // `>>> 0` because the top bit of a symlink's mode makes the shift a negative int32.
  return (mode << ATTRIBUTES_MODE_SHIFT) >>> 0;
}

function declaredSizesOf(placed: Placed): Declared {
  return placed.entry.zip64Sizes === true
    ? { sizeBytes: IN_ZIP64, compressedSizeBytes: IN_ZIP64 }
    : {
        sizeBytes: placed.entry.declaredSize ?? placed.sizeBytes,
        compressedSizeBytes: placed.data.length,
      };
}

/** The field a header defers its two lengths to, in the order such a field writes them. */
function zip64SizesFor(placed: Placed): Buffer {
  const field = Buffer.alloc(EXTRA_HEADER_BYTES + ZIP64_SIZES_BYTES);
  field.writeUInt16LE(ZIP64_EXTRA_ID, EXTRA_ID_AT);
  field.writeUInt16LE(ZIP64_SIZES_BYTES, EXTRA_BYTES_AT);
  field.writeBigUInt64LE(BigInt(placed.entry.declaredSize ?? placed.sizeBytes), ZIP64_SIZE_AT);
  field.writeBigUInt64LE(BigInt(placed.data.length), ZIP64_COMPRESSED_SIZE_AT);
  return field;
}

function localHeaderFor(placed: Placed): Buffer {
  const name = Buffer.from(placed.entry.path, 'utf8');
  const declared = declaredSizesOf(placed);
  const header = Buffer.alloc(LOCAL_HEADER_BYTES);
  LOCAL_SIGNATURE.copy(header);
  header.writeUInt16LE(VERSION, LOCAL_VERSION_AT);
  header.writeUInt16LE(placed.entry.flags ?? NOTHING, LOCAL_FLAGS_AT);
  header.writeUInt16LE(placed.entry.method ?? METHOD_DEFLATED, LOCAL_METHOD_AT);
  header.writeUInt32LE(placed.crc, LOCAL_CRC_AT);
  header.writeUInt32LE(declared.compressedSizeBytes, LOCAL_COMPRESSED_SIZE_AT);
  header.writeUInt32LE(declared.sizeBytes, LOCAL_SIZE_AT);
  header.writeUInt16LE(name.length, LOCAL_NAME_LENGTH_AT);
  return Buffer.concat([header, name]);
}

function directoryHeaderFor(placed: Placed): Buffer {
  const name = Buffer.from(placed.entry.path, 'utf8');
  const declared = declaredSizesOf(placed);
  const extra = placed.entry.zip64Sizes === true ? zip64SizesFor(placed) : Buffer.alloc(NOTHING);
  const header = Buffer.alloc(DIRECTORY_HEADER_BYTES);
  DIRECTORY_SIGNATURE.copy(header);
  header.writeUInt16LE(
    (placed.entry.dos === true ? MADE_BY_DOS : MADE_BY_UNIX) | VERSION,
    MADE_BY_AT,
  );
  header.writeUInt16LE(VERSION, VERSION_NEEDED_AT);
  header.writeUInt16LE(placed.entry.flags ?? NOTHING, FLAGS_AT);
  header.writeUInt16LE(placed.entry.method ?? METHOD_DEFLATED, METHOD_AT);
  header.writeUInt32LE(placed.crc, CRC_AT);
  header.writeUInt32LE(declared.compressedSizeBytes, COMPRESSED_SIZE_AT);
  header.writeUInt32LE(declared.sizeBytes, SIZE_AT);
  header.writeUInt16LE(name.length, NAME_LENGTH_AT);
  header.writeUInt16LE(extra.length, EXTRA_LENGTH_AT);
  header.writeUInt32LE(externalAttributesOf(placed.entry), EXTERNAL_ATTRIBUTES_AT);
  header.writeUInt32LE(placed.headerAt, HEADER_OFFSET_AT);
  return Buffer.concat([header, name, extra]);
}

/**
 * The pair of records an archive too large to describe in the plain one defers to: the record
 * itself, and the locator sitting between it and the record that gave up.
 */
function zip64EndFor({
  entries,
  directoryBytes,
  directoryAt,
}: {
  entries: number;
  directoryBytes: number;
  directoryAt: number;
}): Buffer {
  const record = Buffer.alloc(ZIP64_DIRECTORY_END_BYTES);
  ZIP64_DIRECTORY_END_SIGNATURE.copy(record);
  record.writeBigUInt64LE(
    BigInt(ZIP64_DIRECTORY_END_BYTES - ZIP64_END_SIZE_FROM),
    ZIP64_END_SIZE_AT,
  );
  record.writeBigUInt64LE(BigInt(entries), ZIP64_END_ENTRIES_HERE_AT);
  record.writeBigUInt64LE(BigInt(entries), ZIP64_END_ENTRIES_AT);
  record.writeBigUInt64LE(BigInt(directoryBytes), ZIP64_END_DIRECTORY_BYTES_AT);
  record.writeBigUInt64LE(BigInt(directoryAt), ZIP64_END_DIRECTORY_AT);

  const locator = Buffer.alloc(ZIP64_LOCATOR_BYTES);
  ZIP64_LOCATOR_SIGNATURE.copy(locator);
  locator.writeBigUInt64LE(BigInt(directoryAt + directoryBytes), ZIP64_LOCATOR_END_AT);
  locator.writeUInt32LE(ONE_DISK, ZIP64_LOCATOR_DISKS_AT);
  return Buffer.concat([record, locator]);
}

function directoryEndFor({
  entries,
  directoryBytes,
  directoryAt,
  zip64,
  comment,
}: {
  entries: number;
  directoryBytes: number;
  directoryAt: number;
  zip64: boolean;
  comment: Buffer;
}): Buffer {
  const end = Buffer.alloc(DIRECTORY_END_BYTES);
  DIRECTORY_END_SIGNATURE.copy(end);
  end.writeUInt16LE(zip64 ? COUNT_IN_ZIP64 : entries, END_ENTRIES_HERE_AT);
  end.writeUInt16LE(zip64 ? COUNT_IN_ZIP64 : entries, END_ENTRIES_AT);
  end.writeUInt32LE(zip64 ? IN_ZIP64 : directoryBytes, END_DIRECTORY_BYTES_AT);
  end.writeUInt32LE(zip64 ? IN_ZIP64 : directoryAt, END_DIRECTORY_AT);
  end.writeUInt16LE(comment.length, END_COMMENT_LENGTH_AT);
  return Buffer.concat([end, comment]);
}

/** Every entry with the offset its header goes at, and where the index begins after them all. */
function placedFrom({ entries }: { entries: readonly ZipEntry[] }): {
  placed: readonly Placed[];
  directoryAt: number;
} {
  const placed: Placed[] = [];
  let at = 0;
  for (const entry of entries) {
    const raw = Buffer.from(entry.body ?? '', 'utf8');
    const one: Placed = {
      entry,
      data: dataFor(entry),
      crc: Bun.hash.crc32(new Uint8Array(raw)),
      sizeBytes: raw.length,
      headerAt: at,
    };
    placed.push(one);
    at += localHeaderFor(one).length + one.data.length;
  }
  return { placed, directoryAt: at };
}

export function zipOf({
  entries,
  comment = '',
  zip64 = false,
}: {
  entries: readonly ZipEntry[];
  /** What a record has to be searched past, and what an archive's author controls. */
  comment?: string;
  zip64?: boolean;
}): Uint8Array {
  const { placed, directoryAt } = placedFrom({ entries });
  const body = placed.map((one) => Buffer.concat([localHeaderFor(one), one.data]));
  const directory = Buffer.concat(placed.map(directoryHeaderFor));
  const bounds = { entries: placed.length, directoryBytes: directory.length, directoryAt };

  return new Uint8Array(
    Buffer.concat([
      ...body,
      directory,
      ...(zip64 ? [zip64EndFor(bounds)] : []),
      directoryEndFor({ ...bounds, zip64, comment: Buffer.from(comment, 'utf8') }),
    ]),
  );
}
