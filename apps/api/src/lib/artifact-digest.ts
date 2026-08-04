import type { ObjectKey, Sha256Digest } from '@repo/protocol';

const DIGEST_ALGORITHM = 'sha256';
const HEX_ENCODING = 'hex';

export type ArtifactIdentity = {
  digest: Sha256Digest;
  sizeBytes: number;
  objectKey: ObjectKey;
};

/**
 * The digest a host will verify, taken from the bytes the api is about to store.
 *
 * An uploader-supplied digest could only ever fail out on the host, where it becomes a deploy
 * that never converges rather than a rejected upload.
 */
export function identifyArtifact(bytes: Uint8Array): ArtifactIdentity {
  const digest = new Bun.CryptoHasher(DIGEST_ALGORITHM)
    .update(bytes)
    .digest(HEX_ENCODING) as Sha256Digest;

  return {
    digest,
    sizeBytes: bytes.byteLength,
    objectKey: digest as string as ObjectKey,
  };
}
