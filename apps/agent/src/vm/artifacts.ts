import { FileSystem, Path } from '@effect/platform';
import type { DesiredArtifact, Sha256Digest } from '@repo/protocol';
import { Context, Data, Effect, Layer, Ref, Stream } from 'effect';
import { AwsCredentialProvider } from '#aws/provider.ts';
import { AgentConfig } from '#config.ts';
import { stdoutOf } from '#lib/exec.ts';

const DIGEST_ALGORITHM = 'sha256';
const HEX_ENCODING = 'hex';
const SQUASHFS_FILENAME = 'artifact.squashfs';
/** The path the guest's init execs, fixed by the boot contract. */
const GUEST_BINARY_NAME = 'server';
const BINARY_MODE = 0o755;
const CACHE_DIR_MODE = 0o755;

export class DigestMismatch extends Data.TaggedError('DigestMismatch')<{
  readonly expected: Sha256Digest;
  readonly actual: string;
}> {}

export class ArtifactSizeMismatch extends Data.TaggedError('ArtifactSizeMismatch')<{
  readonly expected: number;
  readonly actual: number;
}> {}

export class ArtifactTransferError extends Data.TaggedError('ArtifactTransferError')<{
  readonly cause: unknown;
}> {}

export class ArtifactStore extends Context.Tag('ArtifactStore')<
  ArtifactStore,
  {
    readonly open: (
      objectKey: string,
    ) => Effect.Effect<ReadableStream<Uint8Array>, ArtifactTransferError>;
  }
>() {}

export const layer = Layer.effect(
  ArtifactStore,
  Effect.gen(function* () {
    const config = yield* AgentConfig;
    const credentials = yield* AwsCredentialProvider;
    return {
      open: (objectKey: string) =>
        credentials.resolve.pipe(
          Effect.flatMap((resolved) =>
            Effect.try(
              () =>
                new Bun.S3Client({
                  bucket: config.artifactBucket,
                  region: config.awsRegion,
                  accessKeyId: resolved.accessKeyId,
                  secretAccessKey: resolved.secretAccessKey,
                  ...(resolved.sessionToken ? { sessionToken: resolved.sessionToken } : {}),
                })
                  .file(objectKey)
                  .stream() as ReadableStream<Uint8Array>,
            ),
          ),
          Effect.mapError((cause) => new ArtifactTransferError({ cause })),
        ),
    };
  }),
);

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
export const downloadAndVerify = ({
  artifact,
  destination,
}: {
  artifact: DesiredArtifact;
  destination: string;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const store = yield* ArtifactStore;
    const hasher = yield* Effect.sync(() => new Bun.CryptoHasher(DIGEST_ALGORITHM));
    const written = yield* Ref.make(0);

    yield* Stream.unwrap(
      Effect.map(store.open(artifact.objectKey), (readable) =>
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

/** The read-only squashfs the guest attaches as `vdb`, built if this host has not seen the digest. */
export const ensureArtifactImage = (artifact: DesiredArtifact) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* AgentConfig;
    const cacheDir = config.artifactCacheDir;
    const imagePath = artifactImagePath({ cacheDir, digest: artifact.digest, path });
    if (yield* fs.exists(imagePath)) {
      return imagePath;
    }

    const stagingDir = path.join(cacheDir, `.staging-${artifact.digest}`);
    const stagedImage = `${stagingDir}.squashfs`;
    return yield* Effect.acquireUseRelease(
      fs
        .remove(stagingDir, { recursive: true, force: true })
        .pipe(
          Effect.andThen(fs.makeDirectory(stagingDir, { recursive: true, mode: CACHE_DIR_MODE })),
        ),
      () =>
        Effect.gen(function* () {
          const binaryPath = path.join(stagingDir, GUEST_BINARY_NAME);
          yield* downloadAndVerify({ artifact, destination: binaryPath });
          yield* fs.chmod(binaryPath, BINARY_MODE);
          yield* fs.remove(stagedImage, { force: true });
          yield* stdoutOf({
            command: ['mksquashfs', stagingDir, stagedImage, '-no-progress', '-noappend'],
          });
          yield* fs.makeDirectory(path.dirname(imagePath), {
            recursive: true,
            mode: CACHE_DIR_MODE,
          });
          yield* fs.rename(stagedImage, imagePath);
          return imagePath;
        }),
      () => fs.remove(stagingDir, { recursive: true, force: true }).pipe(Effect.ignore),
    );
  });
