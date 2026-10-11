import type { AppId } from '@repo/protocol';
import { Data } from 'effect';

export const ZEROFS_CGROUP_PATH = '/sys/fs/cgroup/system.slice/nibrun-zerofs.service';

export const HOST_MEMORY_POLICY = {
  baselineMib: 1024,
  // ZeroFS reached 5.46 GiB RSS with a 2 GB cache during the October 11 OOM.
  zerofsReserveMib: 6144,
  growthHeadroomMib: 512,
  logIntervalMs: 30_000,
} as const;

const BYTES_PER_MIB = 1_048_576;
const KIB_PER_MIB = 1024;

export type HostMemorySample = {
  readonly totalMib: number;
  readonly availableMib: number;
  readonly zerofsMemoryMib: number;
  readonly zerofsReserveMib: number;
  readonly guestCapacityMib: number;
  readonly guestAvailableMib: number;
};

export class HostHasNoRoom extends Data.TaggedError('HostHasNoRoom')<{
  readonly appId: AppId;
  readonly shortfallMib: number;
}> {
  override get message() {
    return `${this.appId} could not be started: its host is ${this.shortfallMib} MiB short of the memory it needs`;
  }
}

function meminfoMib({ text, key }: { text: string; key: string }): number {
  const match = text.match(new RegExp(`^${key}:\\s+(\\d+) kB$`, 'm'));
  if (!match) {
    throw new Error(`host memory field ${key} is missing or invalid`);
  }
  return Math.floor(Number(match[1]) / KIB_PER_MIB);
}

export function guestMemoryMib({
  hostMemoryMib,
  zerofsReserveMib,
}: {
  hostMemoryMib: number;
  zerofsReserveMib: number;
}): number {
  return Math.max(hostMemoryMib - zerofsReserveMib - HOST_MEMORY_POLICY.baselineMib, 0);
}

export function readMemorySample({
  meminfo,
  zerofsCurrentBytes,
  zerofsCacheBytes,
  zerofsReserveMib,
}: {
  meminfo: string;
  zerofsCurrentBytes: string;
  zerofsCacheBytes: number;
  zerofsReserveMib: number;
}): HostMemorySample {
  if (!/^\d+\s*$/.test(zerofsCurrentBytes) || !Number.isSafeInteger(Number(zerofsCurrentBytes))) {
    throw new Error('ZeroFS cgroup memory accounting is invalid');
  }
  const totalMib = meminfoMib({ text: meminfo, key: 'MemTotal' });
  const availableMib = meminfoMib({ text: meminfo, key: 'MemAvailable' });
  if (availableMib > totalMib) {
    throw new Error('host available memory exceeds total memory');
  }
  const zerofsMemoryMib = Math.ceil(Number(zerofsCurrentBytes) / BYTES_PER_MIB);
  const reserveMib = Math.max(
    zerofsReserveMib,
    Math.ceil(zerofsCacheBytes / BYTES_PER_MIB) + HOST_MEMORY_POLICY.growthHeadroomMib,
    zerofsMemoryMib + HOST_MEMORY_POLICY.growthHeadroomMib,
  );
  return {
    totalMib,
    availableMib,
    zerofsMemoryMib,
    zerofsReserveMib: reserveMib,
    guestCapacityMib: guestMemoryMib({ hostMemoryMib: totalMib, zerofsReserveMib: reserveMib }),
    guestAvailableMib: Math.max(availableMib - HOST_MEMORY_POLICY.baselineMib, 0),
  };
}
