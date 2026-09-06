import { Buffer } from 'node:buffer';

/**
 * Tarballs written block by block, because the archives worth testing against are the ones no
 * `tar` will produce: an absolute path, a path climbing out, a device node, a length that lies.
 * A real `tar` is used beside these for the formats it does write.
 */

const BLOCK_BYTES = 512;
const CHECKSUM_AT = 148;
const CHECKSUM_BYTES = 8;
const CHECKSUM_DIGITS = 7;
const HEADER_END = 500;
const SPACE = 0x20;

export const TYPE_FILE = '0';
export const TYPE_DIRECTORY = '5';
export const TYPE_SYMLINK = '2';
export const TYPE_HARDLINK = '1';
export const TYPE_CHAR_DEVICE = '3';
export const TYPE_LONG_NAME = 'L';

export type TarballEntry = {
  path: string;
  type?: string;
  mode?: number;
  linkTarget?: string;
  body?: string;
  /** What the header says the entry is, where that is not what follows it. */
  declaredSize?: number;
  /** The name field alone, for a path a ustar splits across the prefix. */
  prefix?: string;
};

const DEFAULT_MODE = 0o644;

function field({ value, at, size }: { value: string; at: number; size: number }) {
  return { at, bytes: Buffer.from(value.slice(0, size - 1), 'utf8'), size };
}

const OCTAL = 8;

function octalField({ value, at, size }: { value: number; at: number; size: number }) {
  return field({ value: value.toString(OCTAL).padStart(size - 1, '0'), at, size });
}

function headerFor(entry: TarballEntry): Buffer {
  const block = Buffer.alloc(BLOCK_BYTES);
  const body = entry.body ?? '';
  const parts = [
    field({ value: entry.path, at: 0, size: 100 }),
    octalField({ value: entry.mode ?? DEFAULT_MODE, at: 100, size: 8 }),
    octalField({ value: 0, at: 108, size: 8 }),
    octalField({ value: 0, at: 116, size: 8 }),
    octalField({ value: entry.declaredSize ?? Buffer.byteLength(body), at: 124, size: 12 }),
    octalField({ value: 0, at: 136, size: 12 }),
    field({ value: entry.type ?? TYPE_FILE, at: 156, size: 2 }),
    field({ value: entry.linkTarget ?? '', at: 157, size: 100 }),
    field({ value: 'ustar', at: 257, size: 6 }),
    field({ value: '00', at: 263, size: 3 }),
    field({ value: entry.prefix ?? '', at: 345, size: 155 }),
  ];
  for (const part of parts) {
    part.bytes.copy(block, part.at);
  }
  block.fill(SPACE, CHECKSUM_AT, CHECKSUM_AT + CHECKSUM_BYTES);
  let checksum = 0;
  for (const byte of block.subarray(0, HEADER_END)) {
    checksum += byte;
  }
  octalField({ value: checksum, at: CHECKSUM_AT, size: CHECKSUM_DIGITS }).bytes.copy(
    block,
    CHECKSUM_AT,
  );
  return block;
}

function padded(body: Buffer): Buffer {
  const padding = (BLOCK_BYTES - (body.byteLength % BLOCK_BYTES)) % BLOCK_BYTES;
  return padding === 0 ? body : Buffer.concat([body, Buffer.alloc(padding)]);
}

const END_OF_ARCHIVE = Buffer.alloc(BLOCK_BYTES * 2);

export function tarballOf(entries: readonly TarballEntry[]): Uint8Array {
  const blocks = entries.flatMap((entry) => [
    headerFor(entry),
    padded(Buffer.from(entry.body ?? '', 'utf8')),
  ]);
  return new Uint8Array(Buffer.concat([...blocks, END_OF_ARCHIVE]));
}

export function gzippedTarball(entries: readonly TarballEntry[]): Uint8Array {
  return Bun.gzipSync(new Uint8Array(tarballOf(entries)));
}

/** A file whose content is `size` bytes of nothing, which is what an expansion bomb is made of. */
export function zeroFile({ path, size }: { path: string; size: number }): TarballEntry {
  return { path, body: '\0'.repeat(size) };
}
