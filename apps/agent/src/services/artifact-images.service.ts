import { FileSystem, Path } from '@effect/platform';
import type { DesiredArtifact, Sha256Digest } from '@repo/protocol';
import { Deferred, Duration, Effect, Option, Ref } from 'effect';
import {
  artifactImagePath,
  BINARY_MODE,
  downloadAndVerify,
  SQUASHFS_FILENAME,
} from '#lib/vm/artifacts.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { ArtifactStore } from '#services/artifact-store.service.ts';
import { CommandRunner, stdoutOf } from '#services/command-runner.service.ts';

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
const CACHE_DIR_MODE = 0o755;

/** The read-only squashfs the guest attaches as `vdb`, built if this host has not seen the digest. */
const imageFor = Effect.fn('ArtifactImages.imageFor')(function* (artifact: DesiredArtifact) {
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

type ImagePath = Effect.Effect.Success<ReturnType<typeof imageFor>>;
type BuildFailure = Effect.Effect.Error<ReturnType<typeof imageFor>>;
type BuildContext = Effect.Effect.Context<ReturnType<typeof imageFor>>;
type Building = Deferred.Deferred<ImagePath, BuildFailure>;

/**
 * The one way to a digest's image on this host, and one build of it at a time for the process.
 *
 * The staging directory is named by the digest alone, which is what makes a build killed halfway
 * self-healing — the next build of those bytes removes what the last one left, and
 * `artifact-cache.ts` sweeps digest directories and never `.staging-*`. It also means two builds
 * of one digest share a directory: the second's acquire removes the tree the first is still
 * downloading into, and the first writes on through unlinked handles while `chmod` and
 * `mksquashfs` re-resolve the shared path onto whatever the second has written so far. The digest
 * is checked against the download rather than against the packed image, so a squashfs built over
 * half a binary is renamed into the cache and every app that references that digest boots it.
 *
 * Nothing else serialises those callers: the reconcile loop prefetches on its own fiber while a
 * wake cold-boots on the request fiber that asked for it. Joining the build in flight rather than
 * racing it is what lets the staging name stay fixed, and costs the second caller nothing it was
 * not already going to wait for.
 *
 * The first caller in owns the build, as in `AppWaker.wake`, so an interrupt reaches its joiners.
 */
export class ArtifactImages extends Effect.Service<ArtifactImages>()('ArtifactImages', {
  effect: Effect.gen(function* () {
    const context = yield* Effect.context<BuildContext>();
    const building = yield* Ref.make(new Map<Sha256Digest, Building>());

    return {
      ensure: Effect.fn('ArtifactImages.ensure')(function* (artifact: DesiredArtifact) {
        yield* Effect.annotateCurrentSpan({ digest: artifact.digest });
        const claim = yield* Deferred.make<ImagePath, BuildFailure>();
        const held = yield* Ref.modify(building, (current) => {
          const existing = current.get(artifact.digest);
          return existing
            ? ([Option.some(existing), current] as const)
            : ([Option.none<Building>(), new Map(current).set(artifact.digest, claim)] as const);
        });
        if (Option.isSome(held)) {
          return yield* Deferred.await(held.value);
        }
        return yield* imageFor(artifact).pipe(
          Effect.provide(context),
          Effect.onExit((exit) =>
            Deferred.done(claim, exit).pipe(
              Effect.andThen(
                Ref.update(building, (current) => {
                  const remaining = new Map(current);
                  remaining.delete(artifact.digest);
                  return remaining;
                }),
              ),
            ),
          ),
        );
      }),
    };
  }),
  dependencies: [AgentConfig.Default, ArtifactStore.Default, CommandRunner.Default],
}) {}
