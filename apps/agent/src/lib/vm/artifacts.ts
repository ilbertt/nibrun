import { FileSystem, type Path } from '@effect/platform';
import type { DesiredArtifact, Sha256Digest } from '@repo/protocol';
import { Data, Effect, Ref, Stream } from 'effect';

const DIGEST_ALGORITHM = 'sha256';
const HEX_ENCODING = 'hex';
export const SQUASHFS_FILENAME = 'artifact.squashfs';
/** What a binary has to be to be one, wherever it lands — the guest's squashfs or an export. */
export const BINARY_MODE = 0o755;

export class DigestMismatch extends Data.TaggedError('DigestMismatch')<{
  readonly expected: Sha256Digest;
  readonly actual: string;
}> {
  override get message() {
    return `the artifact hashes to ${this.actual}, not to the ${this.expected} it claims`;
  }
}

export class ArtifactSizeMismatch extends Data.TaggedError('ArtifactSizeMismatch')<{
  readonly expected: number;
  readonly actual: number;
}> {
  override get message() {
    return `the artifact is ${this.actual} bytes, not the ${this.expected} its manifest declares`;
  }
}

import { ArtifactStore, ArtifactTransferError } from '#services/artifact-store.service.ts';

/** Content-addressed, so a redeploy of a known digest costs nothing and two apps share one image. */
export const artifactImagePath = ({
  cacheDir,
  digest,
  path,
}: {
  cacheDir: string;
  digest: Sha256Digest;
  path: Path.Path;
}) => path.join(cacheDir, digest, SQUASHFS_FILENAME);

/**
 * Hashed during the transfer rather than after it, so the bytes are never read twice and the
 * file is only moved into the content-addressed cache once it is proven to be what it claims.
 */
export const downloadAndVerify = Effect.fn('downloadAndVerify')(function* ({
  artifact,
  destination,
  bucket,
}: {
  artifact: DesiredArtifact;
  destination: string;
  bucket: string;
}) {
  yield* Effect.annotateCurrentSpan({
    objectKey: artifact.objectKey,
    digest: artifact.digest,
    bucket,
  });
  const fs = yield* FileSystem.FileSystem;
  const store = yield* ArtifactStore;
  const hasher = yield* Effect.sync(() => new Bun.CryptoHasher(DIGEST_ALGORITHM));
  const written = yield* Ref.make(0);

  yield* Stream.unwrap(
    Effect.map(store.open({ bucket, objectKey: artifact.objectKey }), (readable) =>
      Stream.fromReadableStream({
        evaluate: () => readable,
        onError: (cause) => new ArtifactTransferError({ cause }),
      }),
    ),
  ).pipe(
    Stream.tap((chunk) =>
      Effect.zipRight(
        Effect.sync(() => hasher.update(chunk)),
        Ref.update(written, (total) => total + chunk.byteLength),
      ),
    ),
    Stream.run(fs.sink(destination)),
    Effect.onError(() => fs.remove(destination, { force: true }).pipe(Effect.ignore)),
  );

  const actual = yield* Effect.sync(() => hasher.digest(HEX_ENCODING));
  const size = yield* Ref.get(written);
  const mismatch =
    actual !== artifact.digest
      ? new DigestMismatch({ expected: artifact.digest, actual })
      : size !== artifact.sizeBytes
        ? new ArtifactSizeMismatch({ expected: artifact.sizeBytes, actual: size })
        : undefined;
  if (mismatch) {
    yield* fs.remove(destination, { force: true }).pipe(Effect.ignore);
    return yield* mismatch;
  }
});
