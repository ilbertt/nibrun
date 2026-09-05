// A tarball read forwards, once, which is the shape a decompressing stream hands it over in.
//
// Read here rather than by shelling out to `tar`, which is what every other host mechanic does.
// What a seed needs of an archive is a set of refusals — nothing leaving the tree, no device node,
// no ownership carried over, and a running total the unpack stops at — and `tar` has a flag for
// none of them. Every entry is a 512-byte header, every length is in the header in front of its
// data, and the data is padded out to the next block, so a walk is counting rather than seeking.

import { Buffer } from 'node:buffer';

const BLOCK_BYTES = 512;

const NAME_AT = 0;
const NAME_BYTES = 100;
const MODE_AT = 100;
const MODE_BYTES = 8;
const SIZE_AT = 124;
const SIZE_BYTES = 12;
const TYPE_AT = 156;
const LINK_AT = 157;
const LINK_BYTES = 100;
const PREFIX_AT = 345;
const PREFIX_BYTES = 155;

const TYPE_FILE = '0';
/** Anything predating ustar writes a NUL where a modern tar writes the digit. */
const TYPE_FILE_UNSET = '\0';
const TYPE_DIRECTORY = '5';
const TYPE_SYMLINK = '2';
/** GNU's entries carrying the path, and the link target, of the one after them. */
const TYPE_LONG_NAME = 'L';
const TYPE_LONG_LINK = 'K';
/** pax's own metadata, which annotates the header after it rather than describing a file. */
const PAX_TYPES = new Set(['x', 'g']);

/**
 * As much of a long-name entry as will be held to read a path out of. Far longer than any path a
 * filesystem will take, and far short of what the entry could claim: this one entry is read into
 * memory, where every other is walked past a chunk at a time.
 */
const MAX_LONG_FIELD_BYTES = 4096;

const OCTAL = 8;
const OCTAL_DIGITS = /^[0-7]+$/;
/** A number too wide for octal text sets the high bit and uses the rest of the field as base 256. */
const BASE_256_MARKER = 0x80;
const NUL = 0;
const PATH_SEPARATOR = '/';
const MODE_BITS = 0o777;

/**
 * What an unpack does with an entry. Everything that is not one of the first three is a refusal —
 * a device node, a fifo, a hard link — so they are not told apart here: what a caller does with
 * any of them is refuse the archive and name the entry.
 */
export type TarEntryKind = 'file' | 'directory' | 'symlink' | 'unsupported';

export type TarEntry = {
  readonly path: string;
  readonly kind: TarEntryKind;
  /** Permissions only. The bits above them say setuid, and nothing here carries those. */
  readonly mode: number;
  readonly sizeBytes: number;
  /** Where a symlink points, as the archive wrote it; empty for everything else. */
  readonly linkTarget: string;
  /** The entry's own bytes, readable until the next entry is asked for. */
  content(): AsyncGenerator<Uint8Array>;
};

/** What an archive that stops being followable is raised as, wherever it stops being one. */
export class UnreadableTarball extends Error {
  constructor(reason: string) {
    super(`the archive ${reason}`);
    this.name = 'UnreadableTarball';
  }
}

type Header = {
  readonly path: string;
  readonly type: string;
  readonly mode: number;
  readonly sizeBytes: number;
  readonly linkTarget: string;
};

/** What a long-name entry said about the entry after it, until that entry has taken it. */
type Announced = { path?: string; linkTarget?: string };

/**
 * Every entry in the archive, in the order it was written.
 *
 * An entry's `content` is only readable until the next one is asked for: this is one pass over one
 * stream, and the bytes behind it are gone once walked past. Whatever a caller leaves unread is
 * walked past for it, so an entry it refuses costs it nothing to abandon.
 */
export async function* tarEntries(source: ReadableStream<Uint8Array>): AsyncGenerator<TarEntry> {
  const chunks = source[Symbol.asyncIterator]();
  let held = Buffer.alloc(0);
  let ended = false;
  let unread = 0;

  async function pull(): Promise<boolean> {
    if (ended) {
      return false;
    }
    const { done, value } = await chunks.next();
    if (done) {
      ended = true;
      return false;
    }
    held = held.length === 0 ? Buffer.from(value) : Buffer.concat([held, value]);
    return true;
  }

  async function take(count: number): Promise<Buffer | undefined> {
    while (held.length < count) {
      if (!(await pull())) {
        return undefined;
      }
    }
    const taken = Buffer.from(held.subarray(0, count));
    held = held.subarray(count);
    return taken;
  }

  /** The next piece of the entry being read, or nothing once all of it has been handed over. */
  async function pieceOfEntry(): Promise<Buffer | undefined> {
    if (unread === 0) {
      return undefined;
    }
    while (held.length === 0) {
      if (!(await pull())) {
        throw new UnreadableTarball('ended inside the entry it was describing');
      }
    }
    const piece = held.subarray(0, Math.min(unread, held.length));
    held = held.subarray(piece.length);
    unread -= piece.length;
    return piece;
  }

  async function* content(): AsyncGenerator<Uint8Array> {
    let piece = await pieceOfEntry();
    while (piece !== undefined) {
      yield piece;
      piece = await pieceOfEntry();
    }
  }

  /** Whatever is left of the entry being read, and the padding out to the next header. */
  async function walkPast(padding: number): Promise<void> {
    let piece = await pieceOfEntry();
    while (piece !== undefined) {
      piece = await pieceOfEntry();
    }
    if (padding > 0 && (await take(padding)) === undefined) {
      throw new UnreadableTarball('ended inside the padding after an entry');
    }
  }

  /** The whole of a long-name entry, which is the one thing here read into memory. */
  async function longFieldIn(sizeBytes: number): Promise<string> {
    if (sizeBytes > MAX_LONG_FIELD_BYTES) {
      throw new UnreadableTarball('carries a path longer than any filesystem would take');
    }
    unread = sizeBytes;
    const pieces: Buffer[] = [];
    let piece = await pieceOfEntry();
    while (piece !== undefined) {
      pieces.push(piece);
      piece = await pieceOfEntry();
    }
    await walkPast(paddingAfter(sizeBytes));
    return textIn(Buffer.concat(pieces));
  }

  let announced: Announced = {};

  try {
    while (true) {
      const block = await take(BLOCK_BYTES);
      if (block === undefined) {
        throw new UnreadableTarball('ended before it said its entries had');
      }
      // A block of nothing is how a tar says its entries have stopped. What follows is padding
      // out to a tape length, which nothing here reads.
      if (isEnd(block)) {
        return;
      }

      const header = headerIn(block);
      if (header.type === TYPE_LONG_NAME || header.type === TYPE_LONG_LINK) {
        const carried = await longFieldIn(header.sizeBytes);
        announced =
          header.type === TYPE_LONG_NAME
            ? { ...announced, path: carried }
            : { ...announced, linkTarget: carried };
        continue;
      }

      unread = header.sizeBytes;
      const padding = paddingAfter(header.sizeBytes);

      // pax's records annotate the entry after this one rather than describing a file, and what
      // this reads out of a header — the path, the mode, the length — a pax archive still writes
      // in the header. So they are walked past, and the entry they annotate arrives next.
      if (PAX_TYPES.has(header.type)) {
        await walkPast(padding);
        continue;
      }

      yield entryFrom({ header, announced, content });
      announced = {};
      await walkPast(padding);
    }
  } finally {
    await chunks.return?.();
  }
}

function entryFrom({
  header,
  announced,
  content,
}: {
  header: Header;
  announced: Announced;
  content: () => AsyncGenerator<Uint8Array>;
}): TarEntry {
  return {
    path: announced.path ?? header.path,
    kind: kindOf(header.type),
    mode: header.mode & MODE_BITS,
    sizeBytes: header.sizeBytes,
    linkTarget: announced.linkTarget ?? header.linkTarget,
    content,
  };
}

function kindOf(type: string): TarEntryKind {
  if (type === TYPE_FILE || type === TYPE_FILE_UNSET) {
    return 'file';
  }
  if (type === TYPE_DIRECTORY) {
    return 'directory';
  }
  return type === TYPE_SYMLINK ? 'symlink' : 'unsupported';
}

function headerIn(block: Buffer): Header {
  const name = textAt({ block, at: NAME_AT, bytes: NAME_BYTES });
  // ustar splits a path too long for the name field, leading directories first. Joined back here,
  // so a walk never sees the two halves.
  const prefix = textAt({ block, at: PREFIX_AT, bytes: PREFIX_BYTES });
  return {
    path: prefix.length > 0 ? `${prefix}${PATH_SEPARATOR}${name}` : name,
    type: String.fromCharCode(block[TYPE_AT] ?? NUL),
    mode: octalAt({ block, at: MODE_AT, bytes: MODE_BYTES }),
    sizeBytes: octalAt({ block, at: SIZE_AT, bytes: SIZE_BYTES }),
    linkTarget: textAt({ block, at: LINK_AT, bytes: LINK_BYTES }),
  };
}

/**
 * A numeric field, which a tar writes as octal text.
 *
 * Read rather than parsed: `Number.parseInt` takes whatever digits a field opens with and stops at
 * the first byte it cannot use, so a corrupt length would come back as a plausible shorter one and
 * put the walk a few bytes out of step with the headers rather than ending it.
 */
function octalAt({ block, at, bytes }: { block: Buffer; at: number; bytes: number }): number {
  const field = block.subarray(at, at + bytes);
  if (((field[0] ?? NUL) & BASE_256_MARKER) !== 0) {
    throw new UnreadableTarball('has a header field written in a form nibrun does not read');
  }
  const digits = field.toString('latin1').replaceAll('\0', ' ').trim();
  if (digits.length === 0) {
    return 0;
  }
  if (!OCTAL_DIGITS.test(digits)) {
    throw new UnreadableTarball('has a header field that is not a number');
  }
  return Number.parseInt(digits, OCTAL);
}

function paddingAfter(sizeBytes: number): number {
  return (BLOCK_BYTES - (sizeBytes % BLOCK_BYTES)) % BLOCK_BYTES;
}

function isEnd(block: Buffer): boolean {
  return block.every((byte) => byte === NUL);
}

function textAt({ block, at, bytes }: { block: Buffer; at: number; bytes: number }): string {
  return textIn(block.subarray(at, at + bytes));
}

/** A fixed-width field as what was written in it, which ends at the first NUL where there is one. */
function textIn(field: Buffer): string {
  const end = field.indexOf(NUL);
  return field.subarray(0, end < 0 ? field.length : end).toString('utf8');
}
