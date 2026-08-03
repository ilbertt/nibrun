import { statfs } from 'node:fs/promises';
import { availableParallelism, totalmem } from 'node:os';
import type { HostCapacity, InstanceResources } from '@repo/protocol';

const BYTES_PER_MIB = 1_048_576;
const NONE = 0;

export async function readHostCapacity({ cacheDir }: { cacheDir: string }): Promise<HostCapacity> {
  return {
    vcpuCount: availableParallelism(),
    memoryMib: Math.floor(totalmem() / BYTES_PER_MIB),
    cacheBytes: await readCacheBytes({ cacheDir }),
  };
}

async function readCacheBytes({ cacheDir }: { cacheDir: string }): Promise<number> {
  try {
    const stats = await statfs(cacheDir);
    return Number(stats.blocks) * Number(stats.bsize);
  } catch {
    return NONE;
  }
}

export async function readAvailableCacheBytes({ cacheDir }: { cacheDir: string }): Promise<number> {
  try {
    const stats = await statfs(cacheDir);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return NONE;
  }
}

/**
 * What is left after everything currently booted, which is what a placement decision needs.
 * Floored at zero rather than allowed to go negative: an oversubscribed host is a fact to
 * report, not a number to do arithmetic with.
 */
export function allocatableCapacity({
  capacity,
  committed,
  availableCacheBytes,
}: {
  capacity: HostCapacity;
  committed: readonly InstanceResources[];
  availableCacheBytes: number;
}): HostCapacity {
  let usedVcpu = NONE;
  let usedMemory = NONE;
  for (const entry of committed) {
    usedVcpu += entry.vcpuCount;
    usedMemory += entry.memoryMib;
  }
  return {
    vcpuCount: Math.max(capacity.vcpuCount - usedVcpu, NONE),
    memoryMib: Math.max(capacity.memoryMib - usedMemory, NONE),
    cacheBytes: Math.max(Math.min(availableCacheBytes, capacity.cacheBytes), NONE),
  };
}
