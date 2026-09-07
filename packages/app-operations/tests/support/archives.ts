const BLOCK_BYTES = 512;
const TAR_MAGIC_AT = 257;

const encoder = new TextEncoder();

/** A tar's first header, which is the only part of one that says a stream of bytes is a tar. */
export function tarball(): Uint8Array<ArrayBuffer> {
  const block = new Uint8Array(BLOCK_BYTES);
  block.set(encoder.encode('data.db'));
  block.set(encoder.encode('ustar'), TAR_MAGIC_AT);
  return block;
}

/** What an owner actually offers as an app's starting data, and the only thing a send accepts. */
export function gzippedTarball(): Uint8Array<ArrayBuffer> {
  return Bun.gzipSync(tarball());
}

/** What each of a zip's three kinds of record opens with. */
const LOCAL_SIGNATURE = 'PK\u0003\u0004';
const DIRECTORY_SIGNATURE = 'PK\u0001\u0002';
const END_SIGNATURE = 'PK\u0005\u0006';

const LOCAL_HEADER_BYTES = 30;
const LOCAL_VERSION_AT = 4;
const LOCAL_METHOD_AT = 8;
const LOCAL_CRC_AT = 14;
const LOCAL_COMPRESSED_SIZE_AT = 18;
const LOCAL_SIZE_AT = 22;
const LOCAL_NAME_LENGTH_AT = 26;

const DIRECTORY_HEADER_BYTES = 46;
const MADE_BY_AT = 4;
const VERSION_NEEDED_AT = 6;
const METHOD_AT = 10;
const CRC_AT = 16;
const COMPRESSED_SIZE_AT = 20;
const SIZE_AT = 24;
const NAME_LENGTH_AT = 28;

const DIRECTORY_END_BYTES = 22;
const END_ENTRIES_HERE_AT = 8;
const END_ENTRIES_AT = 10;
const END_DIRECTORY_BYTES_AT = 12;
const END_DIRECTORY_AT = 16;

const VERSION = 20;
const STORED = 0;
const ONE_ENTRY = 1;

/** The smallest complete zip there is: one stored entry, its index, and the record naming it. */
export function zip({ name = 'data.db', body = 'rows' }: { name?: string; body?: string } = {}) {
  const named = encoder.encode(name);
  const held = encoder.encode(body);
  const directoryAt = LOCAL_HEADER_BYTES + named.length + held.length;
  const endAt = directoryAt + DIRECTORY_HEADER_BYTES + named.length;
  const bytes = new Uint8Array(endAt + DIRECTORY_END_BYTES);
  const view = new DataView(bytes.buffer);
  const crc = Bun.hash.crc32(held);

  bytes.set(encoder.encode(LOCAL_SIGNATURE));
  view.setUint16(LOCAL_VERSION_AT, VERSION, true);
  view.setUint16(LOCAL_METHOD_AT, STORED, true);
  view.setUint32(LOCAL_CRC_AT, crc, true);
  view.setUint32(LOCAL_COMPRESSED_SIZE_AT, held.length, true);
  view.setUint32(LOCAL_SIZE_AT, held.length, true);
  view.setUint16(LOCAL_NAME_LENGTH_AT, named.length, true);
  bytes.set(named, LOCAL_HEADER_BYTES);
  bytes.set(held, LOCAL_HEADER_BYTES + named.length);

  bytes.set(encoder.encode(DIRECTORY_SIGNATURE), directoryAt);
  view.setUint16(directoryAt + MADE_BY_AT, VERSION, true);
  view.setUint16(directoryAt + VERSION_NEEDED_AT, VERSION, true);
  view.setUint16(directoryAt + METHOD_AT, STORED, true);
  view.setUint32(directoryAt + CRC_AT, crc, true);
  view.setUint32(directoryAt + COMPRESSED_SIZE_AT, held.length, true);
  view.setUint32(directoryAt + SIZE_AT, held.length, true);
  view.setUint16(directoryAt + NAME_LENGTH_AT, named.length, true);
  bytes.set(named, directoryAt + DIRECTORY_HEADER_BYTES);

  bytes.set(encoder.encode(END_SIGNATURE), endAt);
  view.setUint16(endAt + END_ENTRIES_HERE_AT, ONE_ENTRY, true);
  view.setUint16(endAt + END_ENTRIES_AT, ONE_ENTRY, true);
  view.setUint32(endAt + END_DIRECTORY_BYTES_AT, DIRECTORY_HEADER_BYTES + named.length, true);
  view.setUint32(endAt + END_DIRECTORY_AT, directoryAt, true);
  return bytes;
}
