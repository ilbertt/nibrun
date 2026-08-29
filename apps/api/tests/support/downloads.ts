import { Buffer } from 'node:buffer';

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
