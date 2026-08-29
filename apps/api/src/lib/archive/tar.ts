// A tarball read the way a fetch hands it over: forwards, once, with a chunk in hand.
//
// A tar has no index to be behind — it is headers and data alternating to the end — so a walk of
// one is what a walk of a zip has to work to be. Every header is a 512-byte block, every length is
// in the header that precedes its data, and the data is padded out to the next block.

import { Buffer } from 'node:buffer';
import { closing, drained, ofSize, peeked, type Queued, streamed } from '#lib/archive/bytes.ts';
import {
  EntryTooLargeError,
  MAX_ENTRIES,
  UnreadableArchiveError,
  type Unwrapping,
} from '#lib/archive/walk.ts';
import { ELF_MAGIC_LENGTH, isElfExecutable } from '#lib/elf.ts';

const BLOCK_BYTES = 512;

const NAME_AT = 0;
const NAME_BYTES = 100;
const SIZE_AT = 124;
const SIZE_FIELD_BYTES = 12;
const TYPE_AT = 156;
const MAGIC_AT = 257;

/**
 * What every tar written this side of 1988 carries, in the one form both of its dialects share:
 * posix follows it with a NUL and gnu with a space, so five characters is what they agree on.
 */
const MAGIC = 'ustar';

/** Through the magic, which is the last of what says a stream of bytes is a tar at all. */
export const TAR_IDENTITY_BYTES = MAGIC_AT + MAGIC.length;

/** A regular file, written as a digit by anything modern and as a NUL by anything that is not. */
const TYPE_FILE = '0';
const TYPE_FILE_UNSET = '\0';

/** Lengths are octal text, except where the high bit says the rest of the field is base 256. */
const OCTAL = 8;
const BASE_256_MARKER = 0x80;

const NUL = 0;
const PATH_SEPARATOR = '/';

/** Whether these opening bytes are a tar's first header, which is the only thing that says so. */
export function isTarball(opening: Uint8Array): boolean {
  return Buffer.from(opening).subarray(MAGIC_AT, TAR_IDENTITY_BYTES).toString('latin1') === MAGIC;
}

type Entry = {
  name: string;
  sizeBytes: number;
  isFile: boolean;
};

/**
 * The executable inside a tarball, walked to from the front.
 *
 * Every entry's length is known before its data, so what a zip has to find by looking for the
 * record after it, this only has to count.
 */
export async function executableInTarball({
  bytes,
  maxSkippedBytes,
}: {
  bytes: Queued;
  maxSkippedBytes: number;
}): Promise<Unwrapping> {
  let skipped = 0;
  let entries = 0;

  while (skipped <= maxSkippedBytes && entries < MAX_ENTRIES) {
    const block = await bytes.take(BLOCK_BYTES);
    if (block === undefined) {
      await bytes.cancel();
      return { outcome: 'unreadable' };
    }
    // A block of nothing is how a tar says it is over; what follows is padding to a tape length.
    if (isEnd(block)) {
      await bytes.cancel();
      return { outcome: 'no-executable' };
    }

    const entry = entryIn(block);
    if (entry === undefined) {
      await bytes.cancel();
      return { outcome: 'unreadable' };
    }
    skipped += BLOCK_BYTES;
    entries += 1;

    const found = await walkedPast({ bytes, entry, maxSkippedBytes: maxSkippedBytes - skipped });
    if (found.outcome !== 'skipped') {
      return found.outcome === 'unwrapped' ? found.unwrapping : { outcome: 'walked-too-far' };
    }
    skipped += found.readBytes;
  }

  await bytes.cancel();
  return { outcome: 'walked-too-far' };
}

type Walked =
  | { outcome: 'unwrapped'; unwrapping: Unwrapping }
  | { outcome: 'skipped'; readBytes: number }
  /** The entry was not read to its end, so there is no next header to line up on. */
  | { outcome: 'gave-up' };

/** The entry read far enough to say whether it is the executable, and past where it is not. */
async function walkedPast({
  bytes,
  entry,
  maxSkippedBytes,
}: {
  bytes: Queued;
  entry: Entry;
  maxSkippedBytes: number;
}): Promise<Walked> {
  const content = streamed(ofSize({ bytes, sizeBytes: entry.sizeBytes }));
  const { head, body } = await peeked({ stream: content, count: ELF_MAGIC_LENGTH });

  if (entry.isFile && isElfExecutable(head)) {
    return {
      outcome: 'unwrapped',
      unwrapping: {
        outcome: 'unwrapped',
        name: named(entry.name),
        body: streamed(closing({ body, bytes })),
      },
    };
  }

  const readBytes = await drained({ stream: body, budget: maxSkippedBytes });
  if (readBytes < entry.sizeBytes) {
    await bytes.cancel();
    return { outcome: 'gave-up' };
  }
  // The data is written out to a whole number of blocks, and the next header starts after them.
  const padding = paddingAfter(entry.sizeBytes);
  if (padding > 0 && (await bytes.take(padding)) === undefined) {
    throw new UnreadableArchiveError();
  }
  return { outcome: 'skipped', readBytes: readBytes + padding };
}

function paddingAfter(sizeBytes: number): number {
  return (BLOCK_BYTES - (sizeBytes % BLOCK_BYTES)) % BLOCK_BYTES;
}

function isEnd(block: Buffer): boolean {
  return block.every((byte) => byte === NUL);
}

/** The header as what a walk needs of it, or nothing where it does not say a length it can use. */
function entryIn(block: Buffer): Entry | undefined {
  const sizeBytes = sizeIn(block);
  if (sizeBytes === undefined) {
    return undefined;
  }
  const type = String.fromCharCode(block[TYPE_AT] ?? NUL);
  return {
    // The prefix a long path is split across is left where it is: it holds the leading directories,
    // and the name this reports is the last segment either way.
    name: textAt({ block, at: NAME_AT, bytes: NAME_BYTES }),
    sizeBytes,
    isFile: type === TYPE_FILE || type === TYPE_FILE_UNSET,
  };
}

/**
 * The entry's length, which a tar writes as octal text.
 *
 * Eleven digits of octal cannot say more than eight gibibytes, and the way out of that is to set
 * the high bit and use the rest as base 256 — a length past anything storable, and this format's
 * own answer to the problem a zip answers with a field beside the header.
 */
function sizeIn(block: Buffer): number | undefined {
  const field = block.subarray(SIZE_AT, SIZE_AT + SIZE_FIELD_BYTES);
  if (((field[0] ?? NUL) & BASE_256_MARKER) !== 0) {
    throw new EntryTooLargeError();
  }
  const digits = field.toString('latin1').replaceAll('\0', ' ').trim();
  if (digits.length === 0) {
    return 0;
  }
  const size = Number.parseInt(digits, OCTAL);
  return Number.isSafeInteger(size) && size >= 0 ? size : undefined;
}

function textAt({ block, at, bytes }: { block: Buffer; at: number; bytes: number }): string {
  const field = block.subarray(at, at + bytes);
  const end = field.indexOf(NUL);
  return field.subarray(0, end < 0 ? field.length : end).toString('utf8');
}

/** The entry's own name, which is the last segment where the tar kept it in a directory. */
function named(path: string): string {
  return path.split(PATH_SEPARATOR).at(-1) ?? path;
}
