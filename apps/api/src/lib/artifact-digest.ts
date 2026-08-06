import {
  type ObjectKey,
  ObjectKeySchema,
  type Sha256Digest,
  Sha256DigestSchema,
  Value,
} from '@repo/protocol';

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
  const digest = Value.Parse(
    Sha256DigestSchema,
    new Bun.CryptoHasher(DIGEST_ALGORITHM).update(bytes).digest(HEX_ENCODING),
  );

  return {
    digest,
    sizeBytes: bytes.byteLength,
    objectKey: Value.Parse(ObjectKeySchema, digest),
  };
}
