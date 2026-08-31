import { statfs } from 'node:fs/promises';
import { availableParallelism, totalmem } from 'node:os';
import type { HostCapacity, InstanceResources } from '@repo/protocol';
import { Effect } from 'effect';

const BYTES_PER_MIB = 1_048_576;
const NONE = 0;

export type FilesystemSpace = {
  readonly totalBytes: number;
  readonly availableBytes: number;
};

const UNMEASURED: FilesystemSpace = { totalBytes: NONE, availableBytes: NONE };

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

export const readHostCapacity = (cacheDir: string): Effect.Effect<HostCapacity> =>
  Effect.map(spaceOrUnmeasured(cacheDir), (space) => ({
    vcpuCount: availableParallelism(),
    memoryMib: Math.floor(totalmem() / BYTES_PER_MIB),
    cacheBytes: space.totalBytes,
  }));

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
