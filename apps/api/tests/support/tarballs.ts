import { Buffer } from 'node:buffer';
import { gzipSync } from 'node:zlib';

/** An entry as a release tarball carries one, and the ways a writer can have written it. */
export type TarballEntry = {
  name: string;
  content: Uint8Array;
  /** A regular file unless said otherwise: a directory, a symlink, or a header carrying a name. */
  type?: string;
  /** Written as a NUL rather than a digit, which is what anything predating ustar does. */
  typeUnset?: boolean;
  /** Declares its length in base 256, which is what a length past eight gibibytes needs. */
  sizeInBase256?: boolean;
};

export const BLOCK_BYTES = 512;

const NAME_AT = 0;
const MODE_AT = 100;
const SIZE_AT = 124;
const SIZE_FIELD_BYTES = 12;
const CHECKSUM_AT = 148;
const CHECKSUM_FIELD_BYTES = 8;
const TYPE_AT = 156;
const MAGIC_AT = 257;
const VERSION_AT = 263;
const OCTAL = 8;
const BASE_256_MARKER = 0x80;
const END_BLOCKS = 2;
const SPACE = 0x20;
/** Six octal digits and a NUL, then a space, which is the shape a checksum field takes. */
const CHECKSUM_DIGITS = 7;
const FILE_MODE = 0o644;
const MODE_FIELD_BYTES = 8;

/**
 * A tar as far as this end reads one: a 512-byte header before each entry, its data padded out to
 * a whole number of blocks, and two blocks of nothing to say the entries have stopped.
 *
 * The checksum is written properly even though nothing here reads it, so that a fixture that stops
 * working can be handed to `tar` to find out which of the two is wrong.
 */
export function tarballOf(entries: TarballEntry[]): Uint8Array {
  const written: Uint8Array[] = [];

  for (const entry of entries) {
    written.push(headerOf(entry), entry.content, paddingAfter(entry.content.byteLength));
  }
  written.push(Buffer.alloc(END_BLOCKS * BLOCK_BYTES));

  return Buffer.concat(written);
}

/** The same, as a url actually serves one. */
export function gzippedTarballOf(entries: TarballEntry[]): Uint8Array {
  return gzipSync(tarballOf(entries));
}

function headerOf(entry: TarballEntry): Uint8Array {
  const header = Buffer.alloc(BLOCK_BYTES);
  header.write(entry.name, NAME_AT, 'utf8');
  header.write(octal({ value: FILE_MODE, bytes: MODE_FIELD_BYTES }), MODE_AT, 'latin1');
  writeSize({ header, entry });
  header.write(entry.typeUnset === true ? '\0' : (entry.type ?? '0'), TYPE_AT, 'latin1');
  header.write('ustar\0', MAGIC_AT, 'latin1');
  header.write('00', VERSION_AT, 'latin1');
  writeChecksum(header);
  return header;
}

function writeSize({ header, entry }: { header: Buffer; entry: TarballEntry }): void {
  if (entry.sizeInBase256 === true) {
    header[SIZE_AT] = BASE_256_MARKER;
    return;
  }
  header.write(
    octal({ value: entry.content.byteLength, bytes: SIZE_FIELD_BYTES }),
    SIZE_AT,
    'latin1',
  );
}

/** Octal text in a fixed width, NUL-terminated, which is how a tar writes every number it has. */
function octal({ value, bytes }: { value: number; bytes: number }): string {
  return `${value.toString(OCTAL).padStart(bytes - 1, '0')}\0`;
}

/** The sum of every byte in the header, taken as though the checksum field were spaces. */
function writeChecksum(header: Buffer): void {
  header.fill(SPACE, CHECKSUM_AT, CHECKSUM_AT + CHECKSUM_FIELD_BYTES);
  let sum = 0;
  for (const byte of header) {
    sum += byte;
  }
  header.write(`${octal({ value: sum, bytes: CHECKSUM_DIGITS })} `, CHECKSUM_AT, 'latin1');
}

function paddingAfter(sizeBytes: number): Uint8Array {
  return Buffer.alloc((BLOCK_BYTES - (sizeBytes % BLOCK_BYTES)) % BLOCK_BYTES);
}
