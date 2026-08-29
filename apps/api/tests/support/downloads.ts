import { Buffer } from 'node:buffer';
import { EXPANSION_FLOOR_BYTES } from '#lib/archive/walk.ts';

/** What the inspection looks for in the first bytes of anything it is asked to store. */
const ELF_MAGIC = Uint8Array.from('\x7fELF', (character) => character.charCodeAt(0));

/**
 * A payload that expands about a thousandfold and is past the point that ratio is asked about, so
 * it stands for the download a compression bomb is: kilobytes on the wire against a quarter of a
 * gibibyte of decompressing, hashing and storing at the other end.
 *
 * `asExecutable` opens it with the ELF magic. Bytes handed straight to the store rather than
 * walked are refused on their first chunk for not being an executable at all, so a bomb that never
 * claims to be one is stopped by something else entirely and says nothing about this.
 */
export function expandsTooFar({
  asExecutable = false,
}: {
  asExecutable?: boolean;
} = {}): Uint8Array {
  const bytes = new Uint8Array(EXPANSION_FLOOR_BYTES * 2);
  if (asExecutable) {
    bytes.set(ELF_MAGIC);
  }
  return bytes;
}

/**
 * Bytes a compressor cannot shrink, so a fixture built around them is as long on the way in as it
 * is on the way out — and long enough that whoever stops reading one stops with the rest of it
 * still on its way. A download short enough to have already arrived was going to end either way,
 * and proves nothing about what happens to what is left of it.
 */
export function incompressible(sizeBytes: number): Uint8Array {
  const bytes = Buffer.alloc(sizeBytes);
  // Xorshift rather than a linear congruential generator, which gzip finds the shape of and packs
  // thirty times over however many of its bits are taken. Written out rather than drawn at random
  // so that a fixture that starts failing is the same fixture it was passing on.
  let state = 0x9e37_79b9;
  for (let at = 0; at < sizeBytes; at++) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    bytes[at] = state & 0xff;
  }
  return bytes;
}
