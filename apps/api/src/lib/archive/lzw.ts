// Unix `compress`, which a release still turns up in under a `.tar.gz` name. `tar` reads a tarball by
// its bytes rather than by what it was called, so whoever published one never finds out — and
// neither zlib nor a DecompressionStream reads it, which is why this is written out here.
//
// The decoding follows gzip's own `unlzw.c` down to its quirks, because those are what every
// `.Z` in existence was written against rather than anything the format was ever specified as.

import { Buffer } from 'node:buffer';
import { Duplex } from 'node:stream';
import { UnreadableArchiveError } from '#lib/archive/walk.ts';

export const COMPRESS_MAGIC = Buffer.from('\x1f\x9d', 'latin1');

const FLAGS_AT = COMPRESS_MAGIC.length;
const HEADER_BYTES = FLAGS_AT + 1;
const MAX_WIDTH_MASK = 0x1f;
const BLOCK_MODE = 0x80;

const INITIAL_WIDTH = 9;
const LARGEST_WIDTH = 16;

/** Codes below this are the bytes themselves; in block mode it is also the code that resets. */
const CLEAR = 256;
const LITERALS = CLEAR;

/**
 * A code is read in groups of eight, which is a whole number of bytes at any width — and a change
 * of width abandons the rest of the group it happened in, because the original read a group at a
 * time and never looked at what was left of one.
 */
const CODES_PER_GROUP = 8;

const BYTE_BITS = 8;

/**
 * How much is decoded before it is handed on. One code can stand for tens of kilobytes, so what a
 * chunk of input decodes to is handed on a piece at a time rather than once it is all out — which
 * is what lets the bound on how far a source expands stop a bomb part way through one.
 */
const OUTPUT_BYTES = 65_536;

/** The engine a `compress`ed source is read through, in place of a gunzip. */
export function createUncompress(): Duplex {
  return Duplex.from(uncompressed);
}

async function* uncompressed(source: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  let opening = Buffer.alloc(0);
  let decoder: Decoder | undefined;

  for await (const chunk of source) {
    if (decoder !== undefined) {
      yield* decoder.decode(chunk);
      continue;
    }
    opening = Buffer.concat([opening, chunk]);
    if (opening.length >= HEADER_BYTES) {
      decoder = decoderFor(opening);
      yield* decoder.decode(opening.subarray(HEADER_BYTES));
    }
  }

  if (decoder === undefined) {
    throw new UnreadableArchiveError();
  }
  yield* decoder.finish();
}

type Decoder = {
  decode(chunk: Uint8Array): Generator<Uint8Array>;
  finish(): Generator<Uint8Array>;
};

function decoderFor(header: Buffer): Decoder {
  const flags = header[FLAGS_AT] ?? 0;
  const maxWidth = flags & MAX_WIDTH_MASK;
  if (
    !header.subarray(0, COMPRESS_MAGIC.length).equals(COMPRESS_MAGIC) ||
    maxWidth < INITIAL_WIDTH ||
    maxWidth > LARGEST_WIDTH
  ) {
    throw new UnreadableArchiveError();
  }
  const blockMode = (flags & BLOCK_MODE) !== 0;
  const codes = 1 << maxWidth;
  const strings = stringTable(codes);

  // The widest a table may grow is where the last entry fits, except that gzip never lets the
  // first width be the last one — so a `-b9` stream is read nine bits wide, then ten.
  function maxCodeAt(atWidth: number): number {
    return atWidth === maxWidth && atWidth > INITIAL_WIDTH ? codes : (1 << atWidth) - 1;
  }

  let width = INITIAL_WIDTH;
  let maxCode = maxCodeAt(width);
  let nextCode = blockMode ? CLEAR + 1 : CLEAR;
  let previous: number | undefined;
  let lastFirstByte = 0;

  let bits = 0;
  let heldBits = 0;
  let bitsToSkip = 0;
  let codesInGroup = 0;

  let output = Buffer.allocUnsafe(OUTPUT_BYTES + codes);
  let outputBytes = 0;

  function skipHeldBits(): void {
    const skipped = Math.min(bitsToSkip, heldBits);
    bits >>>= skipped;
    heldBits -= skipped;
    bitsToSkip -= skipped;
  }

  function startGroupAtWidth(nextWidth: number): void {
    bitsToSkip = ((CODES_PER_GROUP - codesInGroup) % CODES_PER_GROUP) * width;
    codesInGroup = 0;
    width = nextWidth;
    maxCode = maxCodeAt(width);
    skipHeldBits();
  }

  function read(code: number): void {
    if (blockMode && code === CLEAR) {
      // The code after a reset writes an entry at `CLEAR` from whatever came before it, and the
      // entries after it start where they always do. Nothing can refer to that one, which is the
      // only reason it is harmless.
      nextCode = CLEAR;
      startGroupAtWidth(INITIAL_WIDTH);
      return;
    }
    if (previous === undefined) {
      readFirst(code);
      return;
    }
    readAfter({ code, previous });
  }

  function readFirst(code: number): void {
    if (code >= LITERALS) {
      throw new UnreadableArchiveError();
    }
    previous = code;
    lastFirstByte = code;
    output[outputBytes++] = code;
  }

  function readAfter({ code, previous: before }: { code: number; previous: number }): void {
    if (code > nextCode) {
      throw new UnreadableArchiveError();
    }
    // The one code a decoder is sent before it has the entry: the previous string and its own
    // first byte, which is also the previous string's first byte.
    const length =
      code === nextCode
        ? strings.spell({ code: before, trailing: lastFirstByte })
        : strings.spell({ code, trailing: undefined });
    lastFirstByte = strings.firstByte();
    outputBytes = strings.copyInto({ output, at: outputBytes, length });

    if (nextCode < codes) {
      strings.add({ code: nextCode, prefix: before, suffix: lastFirstByte });
      nextCode += 1;
    }
    previous = code;
    if (nextCode > maxCode) {
      startGroupAtWidth(width + 1);
    }
  }

  function flush(): Buffer {
    const flushed = output.subarray(0, outputBytes);
    output = Buffer.allocUnsafe(OUTPUT_BYTES + codes);
    outputBytes = 0;
    return flushed;
  }

  return {
    *decode(chunk) {
      for (const byte of chunk) {
        bits |= byte << heldBits;
        heldBits += BYTE_BITS;
        skipHeldBits();
        while (bitsToSkip === 0 && heldBits >= width) {
          const code = bits & ((1 << width) - 1);
          bits >>>= width;
          heldBits -= width;
          codesInGroup = (codesInGroup + 1) % CODES_PER_GROUP;
          read(code);
          if (outputBytes >= OUTPUT_BYTES) {
            yield flush();
          }
        }
      }
    },
    *finish() {
      if (outputBytes > 0) {
        yield flush();
      }
    },
  };
}

type StringTable = {
  /** Walks the code back to its first byte, and says how long the string it stands for is. */
  spell(args: { code: number; trailing: number | undefined }): number;
  /** The first byte of what was last spelled. */
  firstByte(): number;
  copyInto(args: { output: Buffer; at: number; length: number }): number;
  add(args: { code: number; prefix: number; suffix: number }): void;
};

/**
 * Every string a code stands for, kept as the code before it and the byte it adds. A string is
 * spelled backwards from its last byte, so it is held reversed until it is copied out.
 */
function stringTable(codes: number): StringTable {
  const prefixes = new Uint16Array(codes);
  const suffixes = new Uint8Array(codes);
  for (let literal = 0; literal < LITERALS; literal += 1) {
    suffixes[literal] = literal;
  }
  // One more than the longest string, for the byte a code sent ahead of its entry carries.
  const reversed = new Uint8Array(codes + 1);
  let length = 0;

  return {
    spell({ code, trailing }) {
      length = 0;
      if (trailing !== undefined) {
        reversed[length++] = trailing;
      }
      let at = code;
      while (at >= LITERALS) {
        // A table only ever points backwards, so this is a corrupt one pointing in a circle.
        if (length >= codes) {
          throw new UnreadableArchiveError();
        }
        reversed[length++] = suffixes[at] ?? 0;
        at = prefixes[at] ?? 0;
      }
      reversed[length++] = at;
      return length;
    },
    firstByte() {
      return reversed[length - 1] ?? 0;
    },
    copyInto({ output, at, length: copied }) {
      for (let index = copied - 1; index >= 0; index -= 1) {
        output[at + copied - 1 - index] = reversed[index] ?? 0;
      }
      return at + copied;
    },
    add({ code, prefix, suffix }) {
      prefixes[code] = prefix;
      suffixes[code] = suffix;
    },
  };
}
