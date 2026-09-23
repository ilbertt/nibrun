import { Buffer } from 'node:buffer';
import { COMPRESS_MAGIC } from '#lib/archive/lzw.ts';

const BLOCK_MODE = 0x80;
const MAX_WIDTH = 16;
const CODES = 1 << MAX_WIDTH;
const INITIAL_WIDTH = 9;
const CLEAR = 256;
const FIRST_ENTRY = CLEAR + 1;
const CODES_PER_GROUP = 8;
const BYTE = 256;
const BYTE_BITS = 8;

/**
 * What `compress -c` writes, from scratch, because the machines the tests run on do not carry it.
 *
 * Checked against `uncompress` when it was written. It resets its table as soon as it fills rather
 * than when the ratio falls as `compress` does, which is still a stream any decoder has to read,
 * and reaches the reset on less input.
 */
export function compressedOf(data: Uint8Array): Uint8Array {
  const written: number[] = [...COMPRESS_MAGIC, BLOCK_MODE | MAX_WIDTH];
  const table = new Map<number, number>();
  let width = INITIAL_WIDTH;
  let maxCode = (1 << width) - 1;
  let nextCode = FIRST_ENTRY;
  let bits = 0;
  let heldBits = 0;
  let codesInGroup = 0;

  function emit(code: number): void {
    bits |= code << heldBits;
    heldBits += width;
    while (heldBits >= BYTE_BITS) {
      written.push(bits & (BYTE - 1));
      bits >>>= BYTE_BITS;
      heldBits -= BYTE_BITS;
    }
    codesInGroup = (codesInGroup + 1) % CODES_PER_GROUP;
  }

  function finishGroup(): void {
    while (codesInGroup !== 0) {
      emit(0);
    }
  }

  let [string] = data;
  if (string === undefined) {
    return Buffer.from(written);
  }
  for (const byte of data.subarray(1)) {
    const key = string * BYTE + byte;
    const known = table.get(key);
    if (known !== undefined) {
      string = known;
      continue;
    }
    emit(string);
    if (nextCode > maxCode) {
      finishGroup();
      width += 1;
      maxCode = width === MAX_WIDTH ? CODES : (1 << width) - 1;
    }
    if (nextCode < CODES) {
      table.set(key, nextCode);
      nextCode += 1;
    } else {
      emit(CLEAR);
      finishGroup();
      table.clear();
      nextCode = FIRST_ENTRY;
      width = INITIAL_WIDTH;
      maxCode = (1 << width) - 1;
    }
    string = byte;
  }
  emit(string);
  if (heldBits > 0) {
    written.push(bits);
  }
  return Buffer.from(written);
}
