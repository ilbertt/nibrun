import { statfs } from 'node:fs/promises';
import { availableParallelism, totalmem } from 'node:os';
import type { HostCapacity, InstanceResources } from '@repo/protocol';
import { Effect } from 'effect';

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
