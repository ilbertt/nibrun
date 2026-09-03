import { FileSystem, Path } from '@effect/platform';
import type { DesiredArtifact, Sha256Digest } from '@repo/protocol';
import { Data, Duration, Effect, Ref, Stream } from 'effect';
import { AgentConfig } from '#services/agent-config.service.ts';
import { stdoutOf } from '#services/command-runner.service.ts';

const DIGEST_ALGORITHM = 'sha256';
const HEX_ENCODING = 'hex';
const SQUASHFS_FILENAME = 'artifact.squashfs';
/**
 * Stored rather than compressed. The image is built once per digest on the path a deploy waits
 * on and is read back off a local disk by one guest, so nothing here crosses a network and the
 * compressor was only ever spending a deploy's seconds to save a host's disk.
 *
 * Level 1 was already the fastest setting worth having — `squashfs-tools` on the host image
 * carries gzip, lzma and lzo only, lzo measures slower than gzip at every level, and a larger
 * block size moves neither. There is nothing left to tune, only the compression itself to drop:
 * on a 78.7 MiB release binary level 1 measured 718ms of the 3.8s that deploy took.
 *
 * What it costs is the image, which roughly doubles — a 78.7 MiB binary goes from 39.8 MiB to
 * 80.8 MiB — and `artifactCacheDir` is never swept, so a long-lived host accumulates twice what
 * it did. Bounding that is worth doing on its own; the cache is only ever a copy of what the
 * bucket still holds, so anything evicted costs a re-fetch and nothing else.
 *
 * The superblock still names gzip, because nothing here is what makes it uncompressed: a guest
 * mounts one of these exactly as it mounts the ones every host already holds.
 */
const SQUASHFS_STORE_UNCOMPRESSED = ['-noI', '-noD', '-noF', '-noX'];
/**
 * What gets squashed, one level inside the staging directory rather than being it.
 *
 * mksquashfs writes its output beside its input and never into it, so the two cannot be the same
 * directory — and while the image was a *sibling* of the staging directory, the release below
 * removed the directory and left the image. Every way a build can end between mksquashfs and the
 * rename then leaked one, and only a later build of the same digest ever cleared it.
 *
 * Nesting both under one directory is what makes that unleakable rather than remembered: there is
 * a single path to remove, and it is the one already being removed.
 */
const STAGED_SOURCE_DIRNAME = 'source';
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
    // Marks it used, which is the whole of what `sweepArtifactCache` orders by. Left alone the
    // timestamp says when the image was *built*, so the digest this host starts every day would
    // be evicted ahead of one fetched once last week and never wanted again. Ignored on failure:
    // a cache entry that cannot be touched is one that ages, not one that fails a deploy.
    yield* Effect.ignore(fs.utimes(imagePath, new Date(), new Date()));
    return imagePath;
  }

  const stagingDir = path.join(cacheDir, `.staging-${artifact.digest}`);
  const stagedSource = path.join(stagingDir, STAGED_SOURCE_DIRNAME);
  const stagedImage = path.join(stagingDir, SQUASHFS_FILENAME);
  return yield* Effect.acquireUseRelease(
    fs
      .remove(stagingDir, { recursive: true, force: true })
      .pipe(
        Effect.andThen(fs.makeDirectory(stagedSource, { recursive: true, mode: CACHE_DIR_MODE })),
      ),
    () =>
      Effect.gen(function* () {
        const binaryPath = path.join(stagedSource, GUEST_BINARY_NAME);
        const [fetching] = yield* Effect.timed(
          downloadAndVerify({ artifact, destination: binaryPath }),
        );
        yield* fs.chmod(binaryPath, BINARY_MODE);
        const [packing] = yield* Effect.timed(
          stdoutOf({
            command: [
              'mksquashfs',
              stagedSource,
              stagedImage,
              '-no-progress',
              '-noappend',
              ...SQUASHFS_STORE_UNCOMPRESSED,
            ],
          }),
        );
        yield* fs.makeDirectory(path.dirname(imagePath), {
          recursive: true,
          mode: CACHE_DIR_MODE,
        });
        yield* fs.rename(stagedImage, imagePath);
        // Only where the image was built, which is the only time it cost anything: a host that
        // already holds the digest returns above and has nothing to say. The two halves are
        // apart because they answer to different things — the transfer to the bucket and the
        // size of the release, the compression to what this host's CPU is doing.
        yield* Effect.logInfo('artifact image built').pipe(
          Effect.annotateLogs({
            digest: artifact.digest,
            sizeBytes: artifact.sizeBytes,
            fetchMs: Duration.toMillis(fetching),
            packMs: Duration.toMillis(packing),
          }),
        );
        return imagePath;
      }),
    () => fs.remove(stagingDir, { recursive: true, force: true }).pipe(Effect.ignore),
  );
});
