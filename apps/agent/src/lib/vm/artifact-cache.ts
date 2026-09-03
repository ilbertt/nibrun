import { FileSystem, Path } from '@effect/platform';
import type { DesiredInstance, Sha256Digest } from '@repo/protocol';
import { Array as Arr, Effect, Option, Order } from 'effect';
import { readFilesystemSpace } from '#lib/report/capacity.ts';
import type { InstanceRecord } from '#lib/report/instance-record.ts';
import { artifactImagePath } from '#lib/vm/artifacts.ts';

const BYTES_PER_GIB = 1_073_741_824;
const NONE = 0;

/**
 * Free space the filesystem the cache sits on keeps for everything that is not the cache. It
 * shares a disk with the guest images, the agent's own state and the journal, none of which have
 * a bound of their own — so this is the one that gives way, and it gives way on its own tick
 * rather than when something else has already failed to write.
 */
const CACHE_RESERVE_GIB = 4;
const CACHE_RESERVE_BYTES = CACHE_RESERVE_GIB * BYTES_PER_GIB;

/**
 * The most of a filesystem the cache may hold even where there is room to spare.
 *
 * Both bounds are needed and neither implies the other. The reserve is what keeps the cache from
 * taking the disk something else was going to need, and it is measured against what is *free* —
 * so on its own it would let the cache grow into every gigabyte nothing else had claimed yet. The
 * share is against the disk's *size*, and is what stops a host from carrying tens of gigabytes of
 * releases nobody has deployed in months.
 */
const CACHE_SHARE_OF_DISK = 0.25;

/** A digest directory, and never `.staging-*`: a build in flight is not a cache entry. */
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export type CachedImage = {
  readonly digest: string;
  readonly sizeBytes: number;
  /** Last use rather than build time — `ensureArtifactImage` touches this on a cache hit. */
  readonly usedAtMs: number;
};

export type CacheDisk = {
  readonly totalBytes: number;
  readonly availableBytes: number;
};

/**
 * Every digest this host must be able to start without going back to the bucket.
 *
 * Desired state and the records both, because they answer different questions. Desired state is
 * what the control plane wants run and covers a release this host has not started yet; the
 * records are what it is actually holding, which covers an app that is idle — and an idle app's
 * image is the one that must not go, because a snapshot restores its drives from paths baked
 * into the vmstate and `lib/vm/snapshot.ts` spells out what happens when those bytes have moved.
 */
export function referencedDigests({
  desired,
  records,
}: {
  desired: readonly DesiredInstance[];
  records: readonly InstanceRecord[];
}): ReadonlySet<string> {
  return new Set<string>([
    ...desired.map((instance) => instance.artifact.digest),
    ...records.map((record) => record.artifactDigest),
  ]);
}

/** All the disk the cache may hold, floored at none for a filesystem with no room at all. */
export function cacheBudget(disk: CacheDisk): number {
  return Math.max(Math.floor(disk.totalBytes * CACHE_SHARE_OF_DISK), NONE);
}

export function heldBytes(images: readonly CachedImage[]): number {
  let held = NONE;
  for (const image of images) {
    held += image.sizeBytes;
  }
  return held;
}

const byLeastRecentlyUsed = Order.mapInput(Order.number, (image: CachedImage) => image.usedAtMs);

/**
 * Which images to let go of, oldest use first, and none that anything still needs.
 *
 * Referenced entries are not merely skipped in the ordering — they are removed from
 * consideration before any of it, so a host whose every image is in use evicts nothing and stays
 * over budget. That is the correct end to be wrong at: the cost of holding one image too many is
 * disk, and the cost of dropping one still in use is a tenant whose app will not start.
 */
export function imagesToEvict({
  images,
  referenced,
  disk,
}: {
  images: readonly CachedImage[];
  referenced: ReadonlySet<string>;
  disk: CacheDisk;
}): readonly CachedImage[] {
  // What has to go for the cache to be inside its share, and for the filesystem to be back above
  // its reserve. The larger of the two, because both have to hold.
  const overBudget = heldBytes(images) - cacheBudget(disk);
  const overReserve = CACHE_RESERVE_BYTES - disk.availableBytes;
  let toReclaim = Math.max(overBudget, overReserve);
  if (toReclaim <= NONE) {
    return [];
  }

  const evictable = Arr.sort(
    images.filter((image) => !referenced.has(image.digest)),
    byLeastRecentlyUsed,
  );

  const evicting: CachedImage[] = [];
  for (const image of evictable) {
    if (toReclaim <= NONE) {
      break;
    }
    evicting.push(image);
    toReclaim -= image.sizeBytes;
  }
  return evicting;
}

/** What the cache is holding, as the decision to drop some of it needs it. */
export const readCachedImages = Effect.fn('artifactCache.readCachedImages')(function* (
  cacheDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entries = yield* fs
    .readDirectory(cacheDir)
    .pipe(Effect.orElseSucceed(() => [] as string[]));
  const images: CachedImage[] = [];
  for (const digest of entries.filter((entry) => DIGEST_PATTERN.test(entry))) {
    const imagePath = artifactImagePath({ cacheDir, digest: digest as Sha256Digest, path });
    const info = yield* Effect.option(fs.stat(imagePath));
    if (Option.isNone(info) || info.value.type !== 'File') {
      continue;
    }
    images.push({
      digest,
      sizeBytes: Number(info.value.size),
      usedAtMs: Option.getOrElse(info.value.mtime, () => new Date(NONE)).getTime(),
    });
  }
  return images;
});

/**
 * Drops the images this host is holding and does not need, once it is holding more than it may.
 *
 * A cache and nothing more: every digest here is also an object in the bucket the agent has
 * credentials to read, so the whole cost of being wrong about one is the fetch that builds it
 * again. That is what makes evicting the right answer where refusing is the right answer for a
 * snapshot — there is nothing to refuse, and a disk that fills takes the agent, the journal and
 * every app's filesystem with it.
 */
export const sweepArtifactCache = Effect.fn('sweepArtifactCache')(function* ({
  cacheDir,
  referenced,
}: {
  cacheDir: string;
  referenced: ReadonlySet<string>;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const disk = yield* readFilesystemSpace(cacheDir);
  const images = yield* readCachedImages(cacheDir);
  const evicting = imagesToEvict({ images, referenced, disk });
  if (evicting.length === NONE) {
    return;
  }

  let reclaimed = NONE;
  for (const image of evicting) {
    yield* fs.remove(path.join(cacheDir, image.digest), { recursive: true, force: true });
    reclaimed += image.sizeBytes;
  }
  yield* Effect.logInfo('artifact images evicted').pipe(
    Effect.annotateLogs({
      evicted: evicting.length,
      reclaimedBytes: reclaimed,
      heldBytes: heldBytes(images) - reclaimed,
      budgetBytes: cacheBudget(disk),
      keptForUse: referenced.size,
    }),
  );
});
