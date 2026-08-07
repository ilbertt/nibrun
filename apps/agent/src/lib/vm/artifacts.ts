import { FileSystem, Path } from '@effect/platform';
import type { DesiredArtifact, Sha256Digest } from '@repo/protocol';
import { Data, Effect, Ref, Stream } from 'effect';
import { AgentConfig } from '#services/agent-config.service.ts';
import { stdoutOf } from '#services/command-runner.service.ts';

const DIGEST_ALGORITHM = 'sha256';
const HEX_ENCODING = 'hex';
const SQUASHFS_FILENAME = 'artifact.squashfs';
/**
 * The image is built once per digest on the path a deploy waits on, and read back off a local
 * disk by one guest — so the compressor's job here is to finish, not to be small. On a 57 MiB
 * release binary this measures 0.56s against 2.6s at the default level, for an image 8% larger.
 *
 * gzip rather than something faster because that is the choice: `squashfs-tools` on the host
 * image is built with gzip, lzma and lzo only, and lzo measures slower than gzip at every level.
 */
const SQUASHFS_COMPRESSION_LEVEL = '1';
/** The path the guest's init execs, fixed by the boot contract. */
const GUEST_BINARY_NAME = 'server';
/** What a binary has to be to be one, wherever it lands — the guest's squashfs or an export. */
export const BINARY_MODE = 0o755;
const CACHE_DIR_MODE = 0o755;

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
}: {
  artifact: DesiredArtifact;
  destination: string;
}) {
  yield* Effect.annotateCurrentSpan({
    objectKey: artifact.objectKey,
    digest: artifact.digest,
  });
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
export const ensureArtifactImage = Effect.fn('ensureArtifactImage')(function* (
  artifact: DesiredArtifact,
) {
  yield* Effect.annotateCurrentSpan({ digest: artifact.digest });
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
          command: [
            'mksquashfs',
            stagingDir,
            stagedImage,
            '-no-progress',
            '-noappend',
            '-Xcompression-level',
            SQUASHFS_COMPRESSION_LEVEL,
          ],
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
