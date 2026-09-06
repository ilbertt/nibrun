import { FilenameSchema, Value } from '@repo/protocol';

const BYTES_PER_GIBIBYTE = 1_073_741_824;
const MAX_IMPORT_GIBIBYTES = 1;

/**
 * Kept in step by hand with `MAX_IMPORT_SIZE_BYTES` in `apps/api/src/services/imports.service.ts`:
 * the api signs the upload for the length it was told and is the end that holds an owner to this,
 * and this is only what the end sending the bytes refuses before it sends them.
 */
export const MAX_IMPORT_SIZE_BYTES = MAX_IMPORT_GIBIBYTES * BYTES_PER_GIBIBYTE;

const GZIP = 'gzip';

/** What a gzip opens with, whatever it turns out to be wrapped around. */
const GZIP_MAGIC = '\u001f\u008b';

/**
 * What every tar carries, in the one form both of its dialects share: posix follows it with a NUL
 * and gnu with a space, so five characters is what they agree on.
 */
const TAR_MAGIC = 'ustar';
const TAR_MAGIC_AT = 257;

/** Through the magic, which is the last of what says a stream of bytes is a tar at all. */
const TAR_IDENTITY_BYTES = TAR_MAGIC_AT + TAR_MAGIC.length;

/**
 * How much of the file is read to answer this.
 *
 * A tar says what it is 262 bytes into its first header and gzip only ever shrinks, so this reaches
 * that for anything but a pathologically incompressible one. Fixed whatever was picked, which is
 * what keeps a decompression bomb out of it: nothing here reads past this many bytes of input, so
 * what the file claims to expand to never costs this end anything.
 */
const OPENING_BYTES = 4096;

/** A file offered as an app's starting data, before anything has agreed that it is one. */
export type OfferedArchive = {
  name: string;
  body: Blob;
};

/**
 * Why this file cannot be the data an app is created holding, or nothing where it can be.
 *
 * The api is the authority and reads the object it was sent for itself — but it can only do that
 * once the upload has finished, so a `.zip` picked here would cost a gibibyte before anybody said a
 * word about it. Answered from the front of the file, which is where the answer is.
 */
export async function refusedArchive({ name, body }: OfferedArchive): Promise<string | undefined> {
  if (body.size === 0) {
    return `There is nothing in ${name} to give the app as its data.`;
  }
  if (body.size > MAX_IMPORT_SIZE_BYTES) {
    return `An app is created with at most ${MAX_IMPORT_GIBIBYTES} GiB of data, and ${name} is more than that.`;
  }
  // The name travels with the archive and is what the api records the upload as, so one it would
  // refuse costs a line here rather than the upload that preceded the refusal.
  if (!Value.Check(FilenameSchema, name)) {
    return `${name} is not a name nibrun takes: it must start with a letter or digit and hold only letters, digits, dots, dashes or underscores.`;
  }
  const opening = await heldFrom({ stream: body.stream(), count: OPENING_BYTES });
  return (await isGzippedTarball(opening))
    ? undefined
    : `${name} is not a .tar.gz. An app's data is created from one archive, whose root becomes the root of data/.`;
}

async function isGzippedTarball(opening: Uint8Array): Promise<boolean> {
  if (!reads({ bytes: opening, at: 0, magic: GZIP_MAGIC })) {
    return false;
  }
  const header = await heldFrom({
    stream: inflating(opening),
    count: TAR_IDENTITY_BYTES,
  });
  return (
    header.length === TAR_IDENTITY_BYTES &&
    reads({ bytes: header, at: TAR_MAGIC_AT, magic: TAR_MAGIC })
  );
}

/**
 * The opening as what it holds, as far as it goes.
 *
 * These bytes are a prefix of a stream, so the inflate ends by running out rather than by finishing,
 * which is the ordinary case here and not a failure. What came out before it stopped is still the
 * front of the archive, and the front is the whole question.
 *
 * Copied into a buffer of its own because a decompression stream takes bytes that are not backed by
 * shared memory, which somebody else's may be.
 */
function inflating(opening: Uint8Array): ReadableStream<Uint8Array> {
  const compressed = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(new Uint8Array(opening));
      controller.close();
    },
  });
  return compressed.pipeThrough(new DecompressionStream(GZIP));
}

/**
 * The front of a stream, and no more of it than that: the reader is cancelled the moment it holds
 * enough, so the rest of a file this size is never pulled through.
 */
async function heldFrom({
  stream,
  count,
}: {
  stream: ReadableStream<Uint8Array>;
  count: number;
}): Promise<Uint8Array> {
  const reader = stream.getReader();
  const held = new Uint8Array(count);
  let filled = 0;

  try {
    while (filled < count) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const wanted = value.subarray(0, count - filled);
      held.set(wanted, filled);
      filled += wanted.length;
    }
  } catch {
    // The source stopped mid-stream, and what came out before it did is still an answer.
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return held.subarray(0, filled);
}

/** A fixed run of bytes read as the latin1 text it would be, which is how a magic is written. */
function reads({ bytes, at, magic }: { bytes: Uint8Array; at: number; magic: string }): boolean {
  return String.fromCharCode(...bytes.subarray(at, at + magic.length)) === magic;
}
