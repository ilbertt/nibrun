import { Buffer } from 'node:buffer';
import { isTarball, TAR_IDENTITY_BYTES } from '#lib/archive/tar.ts';

/** What a gzip opens with, whatever it turns out to be wrapped around. */
const GZIP_MAGIC = Buffer.from('\x1f\x8b', 'latin1');

const GZIP = 'gzip';

/**
 * How much of the source is held to answer this.
 *
 * A tar says what it is 262 bytes into its first header and gzip only ever shrinks, so this reaches
 * that for anything but a pathologically incompressible one. Fixed whatever was uploaded, which is
 * what keeps a decompression bomb out of it: nothing here reads past this many bytes of input, so
 * what the source claims to expand to never costs this end anything.
 */
export const OPENING_BYTES = 4096;

/**
 * Whether the bytes open as a gzipped tarball, read from the front and no further.
 *
 * The envelope only. What is inside is the owner's business, and how much of it there is belongs to
 * the host that unpacks it — this answers the one question the api is in a position to answer
 * cheaply, so that sending the wrong kind of file is a refused upload rather than a filesystem that
 * fails to provision later, where the reason reaches its owner as a broken app.
 */
export async function isGzippedTarball(opening: Uint8Array): Promise<boolean> {
  if (!Buffer.from(opening).subarray(0, GZIP_MAGIC.length).equals(GZIP_MAGIC)) {
    return false;
  }
  const header = await inflatedOpening(opening);
  return header !== undefined && isTarball(header);
}

/**
 * The front of what the gzip holds, or nothing where it does not hold that much.
 *
 * These bytes are a prefix of a stream, so the inflate ends by running out rather than by finishing
 * — which is the ordinary case here and not a failure. What came out before it stopped is still the
 * front of the archive, and the front is the whole question.
 */
async function inflatedOpening(opening: Uint8Array): Promise<Uint8Array | undefined> {
  // Copied into a buffer of its own — at most `OPENING_BYTES` — because a decompression stream
  // takes bytes that are not backed by shared memory, which a slice of somebody else's may be.
  const compressed = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(new Uint8Array(opening));
      controller.close();
    },
  });
  const reader = compressed.pipeThrough(new DecompressionStream(GZIP)).getReader();
  const pieces: Buffer[] = [];
  let held = 0;
  try {
    while (held < TAR_IDENTITY_BYTES) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      pieces.push(Buffer.from(value));
      held += value.byteLength;
    }
  } catch {
    // The prefix ran out mid-stream, which is what a prefix does.
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return held >= TAR_IDENTITY_BYTES ? Buffer.concat(pieces) : undefined;
}
