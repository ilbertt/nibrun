import { statfs } from 'node:fs/promises';
import { availableParallelism, totalmem } from 'node:os';
import type { HostCapacity, InstanceResources, InstanceState } from '@repo/protocol';
import { Effect } from 'effect';
import type { InstanceRecord } from '#lib/report/instance-record.ts';

const BYTES_PER_MIB = 1_048_576;
const NONE = 0;

const filesystemBytes = ({
  cacheDir,
  of,
}: {
  cacheDir: string;
  of: (stats: Awaited<ReturnType<typeof statfs>>) => number;
}) =>
  Effect.tryPromise(() => statfs(cacheDir)).pipe(
    Effect.map(of),
    Effect.orElseSucceed(() => NONE),
  );

export const readAvailableCacheBytes = (cacheDir: string) =>
  filesystemBytes({ cacheDir, of: (stats) => Number(stats.bavail) * Number(stats.bsize) });

/** Read rather than remembered: a host is resized by being replaced, but the agent outlives less. */
export function readHostMemoryMib(): number {
  return Math.floor(totalmem() / BYTES_PER_MIB);
}

export const readHostCapacity = (cacheDir: string): Effect.Effect<HostCapacity> =>
  Effect.map(
    filesystemBytes({ cacheDir, of: (stats) => Number(stats.blocks) * Number(stats.bsize) }),
    (cacheBytes) => ({
      vcpuCount: availableParallelism(),
      memoryMib: readHostMemoryMib(),
      cacheBytes,
    }),
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
