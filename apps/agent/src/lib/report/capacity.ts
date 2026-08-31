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

export const readHostCapacity = (cacheDir: string): Effect.Effect<HostCapacity> =>
  Effect.map(
    filesystemBytes({ cacheDir, of: (stats) => Number(stats.blocks) * Number(stats.bsize) }),
    (cacheBytes) => ({
      vcpuCount: availableParallelism(),
      memoryMib: Math.floor(totalmem() / BYTES_PER_MIB),
      cacheBytes,
    }),
  );

/**
 * The states in which an app has no microVM, and so is holding nothing of the host.
 *
 * `idle` belongs here for the reason the whole of `on-request` does: the memory a sleeping app is
 * not using is the saving, and a host that went on reserving it would pay for every sleep and
 * collect on none of them. What that costs is that the request waking an app can find the host
 * full in the meantime — a real failure mode, and one for the waker to answer rather than one to
 * hide by reserving memory nothing is using.
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
  const usedMemory = sum(committed.map((entry) => entry.memoryMib));
  return {
    vcpuCount: Math.max(capacity.vcpuCount - usedVcpu, NONE),
    memoryMib: Math.max(capacity.memoryMib - usedMemory, NONE),
    cacheBytes: Math.max(Math.min(availableCacheBytes, capacity.cacheBytes), NONE),
  };
}
