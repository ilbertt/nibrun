import { Buffer } from 'node:buffer';
import { isTarball, TAR_IDENTITY_BYTES } from '#lib/archive/tar.ts';
import { ZIP_MAGIC } from '#lib/archive/zip.ts';

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
 * How much of a zip is read before it is taken for one.
 *
 * A local header, and the name of the entry it introduces. The index that makes a zip a zip is at
 * the *end* of the object, which this end does not have: it holds the front of the upload because
 * the front went past on the way to the digest, and fetching the tail would be a second request
 * for a question the host answers properly anyway. So this is the shape of the first record and no
 * more — enough that `zip data.db` is told apart from `gzip data.db`, and not a claim that the
 * archive is sound.
 */
const LOCAL_HEADER_BYTES = 30;
const NAME_LENGTH_AT = 26;

/**
 * Whether the bytes open as one of the two archives an app's data may be created from, read from
 * the front and no further.
 *
 * The envelope only. What is inside is the owner's business, and how much of it there is belongs to
 * the host that unpacks it — this answers the one question the api is in a position to answer
 * cheaply, so that sending the wrong kind of file is a refused upload rather than a filesystem that
 * fails to provision later, where the reason reaches its owner as a broken app.
 */
export async function isAppDataArchive(opening: Uint8Array): Promise<boolean> {
  const held = Buffer.from(opening);
  if (held.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)) {
    return opensAsZip(held);
  }
  if (!held.subarray(0, GZIP_MAGIC.length).equals(GZIP_MAGIC)) {
    return false;
  }
  const header = await inflatedOpening(opening);
  return header !== undefined && isTarball(header);
}

/** A first record whose own fields agree with each other, which random bytes behind a magic do not. */
function opensAsZip(held: Buffer): boolean {
  if (held.length < LOCAL_HEADER_BYTES) {
    return false;
  }
  const nameBytes = held.readUInt16LE(NAME_LENGTH_AT);
  return nameBytes > 0 && LOCAL_HEADER_BYTES + nameBytes <= held.length;
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
