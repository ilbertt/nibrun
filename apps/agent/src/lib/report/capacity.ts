import { statfs } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import type { FileSystem } from '@effect/platform';
import type { HostCapacity, InstanceResources, InstanceState } from '@repo/protocol';
import { Effect } from 'effect';
import type { InstanceRecord } from '#lib/report/instance-record.ts';
import * as Systemd from '#lib/vm/systemd.ts';
import { HostMemory } from '#services/host-memory.service.ts';

const NONE = 0;

export type FilesystemSpace = {
  readonly totalBytes: number;
  readonly availableBytes: number;
};

const UNMEASURED: FilesystemSpace = { totalBytes: NONE, availableBytes: NONE };

export const readGuestMemoryMib = Effect.flatMap(HostMemory, (memory) =>
  Effect.map(memory.read, (sample) => sample?.guestCapacityMib ?? 0),
);

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
}: {
  cacheDir: string;
}): Effect.Effect<HostCapacity, never, FileSystem.FileSystem | HostMemory> =>
  Effect.all({
    space: spaceOrUnmeasured(cacheDir),
    memoryMib: readGuestMemoryMib,
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
    .filter(
      (record) =>
        !HOLDS_NOTHING.includes(record.state) &&
        (record.state !== 'pending' || record.startedAt !== undefined),
    )
    .map((record) => record.resources);
}
export const readCommittedResources = Effect.fn('capacity.readCommittedResources')(function* (
  records: readonly InstanceRecord[],
) {
  const queued = records.filter((record) => record.recovery?.nextAttemptAtMs !== undefined);
  if (queued.length === 0) {
    return committedResources(records);
  }
  const units = yield* Systemd.statuses(queued.map((record) => record.appId));
  return committedResources(
    records.filter(
      (record) =>
        record.recovery?.nextAttemptAtMs === undefined || units.get(record.appId)?.active === true,
    ),
  );
});

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
  availableMemoryMib,
}: {
  capacity: HostCapacity;
  committed: readonly InstanceResources[];
  availableCacheBytes: number;
  availableMemoryMib: number;
}): HostCapacity {
  const usedVcpu = sum(committed.map((entry) => entry.vcpuCount));
  return {
    vcpuCount: Math.max(capacity.vcpuCount - usedVcpu, NONE),
    memoryMib: Math.max(
      Math.min(capacity.memoryMib - committedMemoryMib(committed), availableMemoryMib),
      NONE,
    ),
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
  availableMemoryMib,
}: {
  hostMemoryMib: number;
  committed: readonly InstanceResources[];
  wanted: InstanceResources;
  availableMemoryMib: number;
}): number {
  return Math.max(
    committedMemoryMib(committed) + wanted.memoryMib - hostMemoryMib,
    wanted.memoryMib - availableMemoryMib,
    NONE,
  );
}
