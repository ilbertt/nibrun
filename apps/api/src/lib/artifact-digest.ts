import {
  type ObjectKey,
  ObjectKeySchema,
  type Sha256Digest,
  Sha256DigestSchema,
  Value,
} from '@repo/protocol';
import { ELF_MAGIC_LENGTH, isElfExecutable } from '#lib/elf.ts';

const DIGEST_ALGORITHM = 'sha256';
const HEX_ENCODING = 'hex';

export type ArtifactIdentity = {
  digest: Sha256Digest;
  sizeBytes: number;
  objectKey: ObjectKey;
};

export type ArtifactInspection =
  | ({ outcome: 'stored' } & ArtifactIdentity)
  | { outcome: 'not-executable' }
  | { outcome: 'too-large' };

/**
 * The digest a host will verify, taken from the bytes the store now holds.
 *
 * An uploader-supplied digest could only ever fail out on the host, where it becomes a deploy
 * that never converges rather than a rejected upload — so the bytes are read back and hashed
 * here even though the api never had them in hand.
 *
 * Executability and size are settled in the same pass because the pass is the expensive part:
 * the object is a whole binary, and reading it three times to answer three questions about it
 * would cost three times the bandwidth to reach the same verdict.
 */
export async function inspectArtifact({
  stream,
  maxSizeBytes,
}: {
  stream: ReadableStream<Uint8Array>;
  maxSizeBytes: number;
}): Promise<ArtifactInspection> {
  const hasher = new Bun.CryptoHasher(DIGEST_ALGORITHM);
  const magic: number[] = [];
  let sizeBytes = 0;

  for await (const chunk of stream) {
    magic.push(...chunk.slice(0, ELF_MAGIC_LENGTH - magic.length));
    // Leaving the loop cancels the read, so something that was never a binary costs one chunk
    // rather than the whole object.
    if (magic.length >= ELF_MAGIC_LENGTH && !isElfExecutable(Uint8Array.from(magic))) {
      return { outcome: 'not-executable' };
    }

    sizeBytes += chunk.byteLength;
    if (sizeBytes > maxSizeBytes) {
      return { outcome: 'too-large' };
    }

    hasher.update(chunk);
  }

  // Shorter than the magic itself, so the loop above never reached a verdict.
  if (!isElfExecutable(Uint8Array.from(magic))) {
    return { outcome: 'not-executable' };
  }

  const digest = Value.Parse(Sha256DigestSchema, hasher.digest(HEX_ENCODING));

  return {
    outcome: 'stored',
    digest,
    sizeBytes,
    objectKey: Value.Parse(ObjectKeySchema, digest),
  };
}
