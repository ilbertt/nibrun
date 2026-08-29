import {
  type ObjectKey,
  ObjectKeySchema,
  type Sha256Digest,
  Sha256DigestSchema,
  Value,
} from '@repo/protocol';
import { ELF_MAGIC_LENGTH, interpreterOf, isElfExecutable, isGuestInterpreter } from '#lib/elf.ts';

const DIGEST_ALGORITHM = 'sha256';
const HEX_ENCODING = 'hex';

/**
 * How much of the object is held to read the program headers out of.
 *
 * The interpreter is named by a segment the linker puts near the front — a kibibyte or two in,
 * across every toolchain seen here — and one that sat past this would be read as a binary that
 * names none, which is the lenient verdict. Generous rather than exact because the cost is one
 * buffer per upload and the cost of being wrong is a rejected deploy.
 */
const HEADER_BYTES = 65_536;

export type ArtifactIdentity = {
  digest: Sha256Digest;
  sizeBytes: number;
  objectKey: ObjectKey;
};

export type ArtifactInspection =
  | ({ outcome: 'stored' } & ArtifactIdentity)
  | { outcome: 'not-executable' }
  | { outcome: 'unsupported-interpreter'; interpreter: string }
  | { outcome: 'too-large' };

/** Only ever a verdict on a loader path actually read; see `interpreterOf`. */
function refuseInterpreter(bytes: Uint8Array): ArtifactInspection | undefined {
  const interpreter = interpreterOf(bytes);
  return interpreter !== undefined && !isGuestInterpreter(interpreter)
    ? { outcome: 'unsupported-interpreter', interpreter }
    : undefined;
}

/** Whatever the bytes read so far already settle; `undefined` while the rest could still change it. */
function refuseChunk({
  header,
  headerLength,
  headerJustFilled,
  sizeBytes,
  maxSizeBytes,
}: {
  header: Uint8Array;
  headerLength: number;
  headerJustFilled: boolean;
  sizeBytes: number;
  maxSizeBytes: number;
}): ArtifactInspection | undefined {
  if (headerLength >= ELF_MAGIC_LENGTH && !isElfExecutable(header)) {
    return { outcome: 'not-executable' };
  }
  // Only on the chunk that completes the header, so parsing the segments costs one pass rather
  // than one per chunk.
  const refusal = headerJustFilled ? refuseInterpreter(header) : undefined;
  if (refusal) {
    return refusal;
  }
  return sizeBytes > maxSizeBytes ? { outcome: 'too-large' } : undefined;
}

/**
 * The inspection as it is made, a chunk at a time.
 *
 * Held apart from where the bytes come from because they come two ways: read back out of the store
 * after an upload, or on their way into it from a url. Both reach the same verdict from the same
 * pass; only who is pulling the chunks differs.
 */
function reading({ maxSizeBytes }: { maxSizeBytes: number }) {
  const hasher = new Bun.CryptoHasher(DIGEST_ALGORITHM);
  const header = new Uint8Array(HEADER_BYTES);
  let headerLength = 0;
  let sizeBytes = 0;

  return {
    /** Whatever this chunk already settles; `undefined` while the rest could still change it. */
    take(chunk: Uint8Array): ArtifactInspection | undefined {
      const wasComplete = headerLength === HEADER_BYTES;
      if (!wasComplete) {
        const taken = Math.min(chunk.byteLength, HEADER_BYTES - headerLength);
        header.set(chunk.subarray(0, taken), headerLength);
        headerLength += taken;
      }
      sizeBytes += chunk.byteLength;

      const refusal = refuseChunk({
        header,
        headerLength,
        headerJustFilled: !wasComplete && headerLength === HEADER_BYTES,
        sizeBytes,
        maxSizeBytes,
      });
      if (refusal) {
        return refusal;
      }

      hasher.update(chunk);
      return undefined;
    },

    /** What the bytes came to, once there are no more of them. */
    verdict(): ArtifactInspection {
      const read = header.subarray(0, headerLength);
      // Shorter than the magic itself, so no chunk ever reached a verdict.
      if (!isElfExecutable(read)) {
        return { outcome: 'not-executable' };
      }
      if (headerLength < HEADER_BYTES) {
        const refusal = refuseInterpreter(read);
        if (refusal) {
          return refusal;
        }
      }

      const digest = Value.Parse(Sha256DigestSchema, hasher.digest(HEX_ENCODING));

      return {
        outcome: 'stored',
        digest,
        sizeBytes,
        objectKey: Value.Parse(ObjectKeySchema, digest),
      };
    },
  };
}

/**
 * The digest a host will verify, taken from the bytes the store now holds.
 *
 * An uploader-supplied digest could only ever fail out on the host, where it becomes a deploy
 * that never converges rather than a rejected upload — so the bytes are read back and hashed
 * here even though the api never had them in hand.
 *
 * Executability, the loader it asks for, and size are settled in the same pass because the pass
 * is the expensive part: the object is a whole binary, and reading it four times to answer four
 * questions about it would cost four times the bandwidth to reach the same verdict.
 */
export async function inspectArtifact({
  stream,
  maxSizeBytes,
}: {
  stream: ReadableStream<Uint8Array>;
  maxSizeBytes: number;
}): Promise<ArtifactInspection> {
  const read = reading({ maxSizeBytes });

  for await (const chunk of stream) {
    // Leaving the loop cancels the read, so an object that can already be refused costs one
    // chunk rather than the whole of itself.
    const refusal = read.take(chunk);
    if (refusal) {
      return refusal;
    }
  }

  return read.verdict();
}

/**
 * What more bytes than may ever be stored is raised as, on their way in from somewhere this end
 * cannot hold to a length: an upload is signed for the size it declared, but a url is followed on
 * the strength of what the host says about it — and a host that says nothing would otherwise be
 * read until it stopped.
 */
export class ArtifactTooLargeError extends Error {
  constructor() {
    super('More bytes than may be stored.');
    this.name = 'ArtifactTooLargeError';
  }
}

/**
 * The bytes as far as the cap, and an error rather than a truncation past it: what is being read
 * is a binary, and the first half of one is not a smaller binary.
 */
export function boundedTo({
  maxSizeBytes,
}: {
  maxSizeBytes: number;
}): TransformStream<Uint8Array, Uint8Array> {
  let read = 0;

  return new TransformStream<Uint8Array, Uint8Array>({
    // biome-ignore lint/complexity/useMaxParams: a transform is handed what to pass it on to
    transform(chunk, controller) {
      read += chunk.byteLength;
      if (read > maxSizeBytes) {
        controller.error(new ArtifactTooLargeError());
        return;
      }
      controller.enqueue(chunk);
    },
  });
}

/** What a refusal is raised as, so that whoever was writing the bytes stops and says why. */
export class RefusedArtifactError extends Error {
  readonly inspection: ArtifactInspection;

  constructor(inspection: ArtifactInspection) {
    super(`The bytes were refused: ${inspection.outcome}`);
    this.inspection = inspection;
  }
}

/**
 * The same inspection, made of bytes on their way somewhere else.
 *
 * A pass-through rather than a second reader: the bytes are hashed as they are handed on, so one
 * chunk is in hand at a time. Teeing the stream instead would have made the two readers race — the
 * hash runs at memory speed and an upload does not — and everything the slower one had not reached
 * would sit in a queue, which for a binary is the whole binary.
 *
 * A refusal errors the stream rather than ending it: whoever is writing has to stop where they
 * are, and a half-written object is not something to mistake for what was asked for.
 */
export function inspectingPassThrough({ maxSizeBytes }: { maxSizeBytes: number }): {
  through: TransformStream<Uint8Array, Uint8Array>;
  inspection: Promise<ArtifactInspection>;
} {
  const read = reading({ maxSizeBytes });
  const { promise, resolve } = Promise.withResolvers<ArtifactInspection>();

  const through = new TransformStream<Uint8Array, Uint8Array>({
    // biome-ignore lint/complexity/useMaxParams: a transform is handed what to pass it on to
    transform(chunk, controller) {
      const refusal = read.take(chunk);
      if (refusal) {
        resolve(refusal);
        controller.error(new RefusedArtifactError(refusal));
        return;
      }
      controller.enqueue(chunk);
    },
    flush() {
      resolve(read.verdict());
    },
  });

  return { through, inspection: promise };
}
