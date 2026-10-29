import { type DesiredArtifact, Sha256DigestSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { StoredObject } from '#lib/nibrunner/desired.gen.ts';

const TAR_BLOCK_BYTES = 512;
const TAR_END_BLOCKS = 2;

export function localArtifactReference(artifact: Pick<DesiredArtifact, 'digest'>) {
  return { digest: artifact.digest, objectKey: artifact.digest } satisfies StoredObject;
}

export function emptyDataArchive() {
  const bytes = Bun.gzipSync(new Uint8Array(TAR_BLOCK_BYTES * TAR_END_BLOCKS));
  const digest = Value.Parse(
    Sha256DigestSchema,
    new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
  );
  return { bytes, ...localArtifactReference({ digest }) };
}
