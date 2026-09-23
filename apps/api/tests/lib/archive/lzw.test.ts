import { describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { decompressed, streamed } from '#lib/archive/bytes.ts';
import { COMPRESS_MAGIC, createUncompress } from '#lib/archive/lzw.ts';
import { UnreadableArchiveError } from '#lib/archive/walk.ts';
import { collected, NOTES, NOTHING, streamOf } from '#tests/lib/archive/support/fixtures.ts';
import { compressedOf } from '#tests/support/compress.ts';
import { incompressible } from '#tests/support/downloads.ts';

/** Enough codes that the table fills and is reset more than once, at every width on the way. */
const PAST_SEVERAL_RESETS = 393_216;

const BLOCK_MODE = 0x80;
const MAX_WIDTH = 16;
const INITIAL_WIDTH = 9;

const HEADER = Buffer.from([...COMPRESS_MAGIC, BLOCK_MODE | MAX_WIDTH]);
const TOO_WIDE = Buffer.from([...COMPRESS_MAGIC, BLOCK_MODE | (MAX_WIDTH + 1)]);

/** A literal, then a code past the one entry a single literal lets the decoder make. */
const A_LITERAL = 'A'.charCodeAt(0);
const AN_ENTRY_NOT_YET_MADE = 300;
const TWO_CODES_BYTES = 3;

describe('a `compress`ed stream is read back to what was compressed', () => {
  test('text, which reuses the table it builds', async () => {
    expect(await uncompressed(compressedOf(NOTES))).toEqual(Buffer.from(NOTES));
  });

  test('past every change of width and every reset of the table', async () => {
    const data = incompressible(PAST_SEVERAL_RESETS);

    expect(await uncompressed(compressedOf(data))).toEqual(data);
  });

  test('a stream of nothing', async () => {
    expect(await uncompressed(compressedOf(NOTHING))).toEqual(Buffer.alloc(0));
  });
});

describe('a stream that is not one it could have written is unreadable', () => {
  test('a code for an entry the table does not have yet', async () => {
    await expect(
      uncompressed(Buffer.concat([HEADER, codesOf([A_LITERAL, AN_ENTRY_NOT_YET_MADE])])),
    ).rejects.toBeInstanceOf(UnreadableArchiveError);
  });

  test('a header asking for wider codes than the format has', async () => {
    await expect(uncompressed(TOO_WIDE)).rejects.toBeInstanceOf(UnreadableArchiveError);
  });

  test('a stream that ends inside its header', async () => {
    await expect(uncompressed(COMPRESS_MAGIC)).rejects.toBeInstanceOf(UnreadableArchiveError);
  });
});

async function uncompressed(bytes: Uint8Array): Promise<Uint8Array> {
  return await collected(
    streamed(decompressed({ engine: createUncompress(), data: streamOf(bytes) })),
  );
}

/** Two codes at the first width, least significant bit first, as `compress` packs them. */
function codesOf([first, second]: [number, number]): Buffer {
  const packed = Buffer.alloc(TWO_CODES_BYTES);
  packed.writeUIntLE(first | (second << INITIAL_WIDTH), 0, TWO_CODES_BYTES);
  return packed;
}
