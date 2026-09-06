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
