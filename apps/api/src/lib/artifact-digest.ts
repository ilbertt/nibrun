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
  const hasher = new Bun.CryptoHasher(DIGEST_ALGORITHM);
  const header = new Uint8Array(HEADER_BYTES);
  let headerLength = 0;
  let sizeBytes = 0;

  for await (const chunk of stream) {
    const wasComplete = headerLength === HEADER_BYTES;
    if (!wasComplete) {
      const taken = Math.min(chunk.byteLength, HEADER_BYTES - headerLength);
      header.set(chunk.subarray(0, taken), headerLength);
      headerLength += taken;
    }
    sizeBytes += chunk.byteLength;

    // Leaving the loop cancels the read, so an object that can already be refused costs one
    // chunk rather than the whole of itself.
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
  }

  const read = header.subarray(0, headerLength);
  // Shorter than the magic itself, so the loop above never reached a verdict.
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
}
