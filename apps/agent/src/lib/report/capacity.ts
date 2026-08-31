import { statfs } from 'node:fs/promises';
import { availableParallelism, totalmem } from 'node:os';
import type { FileSystem } from '@effect/platform';
import type { HostCapacity, InstanceResources, InstanceState } from '@repo/protocol';
import { Effect, Either } from 'effect';
import type { InstanceRecord } from '#lib/report/instance-record.ts';
import { readCacheMemoryBytes } from '#lib/volumes/zerofs.ts';

const BYTES_PER_MIB = 1_048_576;
const NONE = 0;

export type FilesystemSpace = {
  readonly totalBytes: number;
  readonly availableBytes: number;
};

const UNMEASURED: FilesystemSpace = { totalBytes: NONE, availableBytes: NONE };

/** Read rather than remembered: a host is resized by being replaced, but the agent outlives less. */
export function readHostMemoryMib(): number {
  return Math.floor(totalmem() / BYTES_PER_MIB);
}

/**
 * Host memory that is nobody's guest to take: the kernel, this agent, Caddy, and the Firecracker
 * process standing in front of each microVM, which costs a few MiB over and above the RAM its
 * guest was configured with.
 *
 * Rounder than a measurement of any of them, because it is a floor and not a reading. What it
 * buys is that the host stays answerable once it is full — an agent that has sold the last of its
 * memory to tenants cannot report, cannot converge and cannot be asked to give any of it back.
 */
const HOST_BASELINE_MIB = 1024;

/**
 * What ZeroFS is assumed to want when its own config cannot be read, which is the number that
 * config holds today.
 *
 * Guessed rather than raised into a failure, because the two ways of being wrong are not
 * symmetrical: a host that reports no capacity is one nothing is ever placed on, where a host
 * that reports memory it does not have kills a tenant — and, ZeroFS being the disk every app on
 * the host runs through, most likely several of them.
 */
const ASSUMED_ZEROFS_CACHE_MIB = 2048;

/**
 * The memory a guest may actually be given, which is the host's total less what is already spoken
 * for. ZeroFS fills its cache lazily, exactly as it fills the disk one, so free memory on a host
 * that has just booted is not memory that is going spare.
 *
 * **The one number both the report and a wake are made on.** They have to agree by construction
 * rather than by coincidence: a host that refused wakes by one measure while telling the control
 * plane it had room by another would go on being placed onto for as long as it went on refusing.
 */
export function guestMemoryMib({
  hostMemoryMib,
  zerofsCacheMib,
}: {
  hostMemoryMib: number;
  zerofsCacheMib: number;
}): number {
  return Math.max(hostMemoryMib - zerofsCacheMib - HOST_BASELINE_MIB, NONE);
}

export const readGuestMemoryMib = Effect.fn('capacity.readGuestMemoryMib')(function* (
  zerofsConfigFile: string,
) {
  const configured = yield* Effect.either(readCacheMemoryBytes(zerofsConfigFile));
  if (Either.isLeft(configured)) {
    yield* Effect.logWarning('zerofs memory cache could not be read').pipe(
      Effect.annotateLogs({
        assumedMib: ASSUMED_ZEROFS_CACHE_MIB,
        reason: configured.left.message,
      }),
    );
  }
  return guestMemoryMib({
    hostMemoryMib: readHostMemoryMib(),
    zerofsCacheMib: Either.isLeft(configured)
      ? ASSUMED_ZEROFS_CACHE_MIB
      : Math.ceil(configured.right / BYTES_PER_MIB),
  });
});

/**
 * Fails where the path cannot be stat'd, which a report can shrug off and a decision about what
 * else may be written to that disk cannot: a zero there reads as a full disk, and a zero total
 * reads as no disk at all.
 */
export const readFilesystemSpace = (directory: string) =>
  Effect.map(
    Effect.tryPromise(() => statfs(directory)),
    (stats): FilesystemSpace => ({
      totalBytes: Number(stats.blocks) * Number(stats.bsize),
      availableBytes: Number(stats.bavail) * Number(stats.bsize),
    }),
  );

const spaceOrUnmeasured = (directory: string) =>
  readFilesystemSpace(directory).pipe(Effect.orElseSucceed(() => UNMEASURED));

export const readAvailableCacheBytes = (cacheDir: string) =>
  Effect.map(spaceOrUnmeasured(cacheDir), (space) => space.availableBytes);

/**
 * `memoryMib` is what may be given to guests rather than what the instance was sold with — the
 * host's own needs are not capacity, and reporting them as capacity is what fills a host past
 * what it can carry.
 */
export const readHostCapacity = ({
  cacheDir,
  zerofsConfigFile,
}: {
  cacheDir: string;
  zerofsConfigFile: string;
}): Effect.Effect<HostCapacity, never, FileSystem.FileSystem> =>
  Effect.all({
    space: spaceOrUnmeasured(cacheDir),
    memoryMib: readGuestMemoryMib(zerofsConfigFile),
  }).pipe(
    Effect.map(({ space, memoryMib }) => ({
      vcpuCount: availableParallelism(),
      memoryMib,
      cacheBytes: space.totalBytes,
    })),
  );

/**
 * The states in which an app has no microVM, and so is holding nothing of the host.
 *
 * `idle` belongs here for the reason the whole of `on-request` does: the memory a sleeping app is
 * not using is the saving, and a host that went on reserving it would pay for every sleep and
 * collect on none of them. What that costs is that the request waking an app can find the host
 * full in the meantime — a real failure mode, and one the waker answers with `memoryShortfallMib`
 * rather than one to hide by reserving memory nothing is using.
 */
const HOLDS_NOTHING: readonly InstanceState[] = ['idle', 'stopped', 'failed'];

/** What the apps on this host are holding of it, which is what `allocatable` is the remainder of. */
export function committedResources(
  records: readonly InstanceRecord[],
): readonly InstanceResources[] {
  return records
    .filter((record) => !HOLDS_NOTHING.includes(record.state))
    .map((record) => record.resources);
}
const sum = (values: readonly number[]) => {
  let total = NONE;
  for (const value of values) {
    total += value;
  }
  return total;
};

function committedMemoryMib(committed: readonly InstanceResources[]): number {
  return sum(committed.map((entry) => entry.memoryMib));
}

/** Floored at zero: an oversubscribed host is a fact to report, not a number to do arithmetic with. */
export function allocatableCapacity({
  capacity,
  committed,
  availableCacheBytes,
}: {
  capacity: HostCapacity;
  committed: readonly InstanceResources[];
  availableCacheBytes: number;
}): HostCapacity {
  const usedVcpu = sum(committed.map((entry) => entry.vcpuCount));
  return {
    vcpuCount: Math.max(capacity.vcpuCount - usedVcpu, NONE),
    memoryMib: Math.max(capacity.memoryMib - committedMemoryMib(committed), NONE),
    cacheBytes: Math.max(Math.min(availableCacheBytes, capacity.cacheBytes), NONE),
  };
}

/**
 * How much more memory this host would need to carry one more microVM, and zero when it has room.
 *
 * Memory alone. vCPUs are time-shared, so a host that has sold more of them than it has runs
 * everything on it more slowly; memory is the one it cannot divide, and a guest that does not fit
 * is not refused but killed — along with whichever neighbour the kernel picks instead.
 *
 * The arithmetic `allocatableCapacity` reports, deliberately and not by coincidence: a host that
 * refused wakes by one measure while telling the control plane it had room by another would go on
 * being placed onto for exactly as long as it went on refusing.
 */
export function memoryShortfallMib({
  hostMemoryMib,
  committed,
  wanted,
}: {
  hostMemoryMib: number;
  committed: readonly InstanceResources[];
  wanted: InstanceResources;
}): number {
  return Math.max(committedMemoryMib(committed) + wanted.memoryMib - hostMemoryMib, NONE);
}
