import { mkdir, open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { VolumeId } from '@repo/protocol';

// ZeroFS resolves every NBD export by looking this directory up on each negotiation, so a
// device file appears the moment it is created — no restart, no registration step.
export const NBD_DIRECTORY = '.nbd';

// Firecracker sizes a block device with lseek and computes sectors as `size >> 9`. A size that
// is not a multiple of 512 leaves the tail invisible to the guest, with a warning and no error.
const SECTOR_SIZE_BYTES = 512;

export const isSectorAligned = (sizeBytes: number) => sizeBytes % SECTOR_SIZE_BYTES === 0;

export const alignToSector = (sizeBytes: number) =>
  Math.ceil(sizeBytes / SECTOR_SIZE_BYTES) * SECTOR_SIZE_BYTES;

export const devicePathFor = ({ mount, volumeId }: { mount: string; volumeId: VolumeId }) =>
  join(mount, NBD_DIRECTORY, volumeId);

export class VolumeShrinkError extends Error {
  constructor({ current, requested }: { current: number; requested: number }) {
    super(`Refusing to shrink a volume from ${current} to ${requested} bytes`);
    this.name = 'VolumeShrinkError';
  }
}

export async function readDeviceFileSize({ path }: { path: string }): Promise<number | undefined> {
  try {
    return (await stat(path)).size;
  } catch {
    return undefined;
  }
}

/**
 * Creates or grows the sparse file ZeroFS exports as this volume's block device.
 *
 * Growing preserves the data; shrinking discards everything past the new size, which is why a
 * smaller desired size is refused rather than obeyed. Desired state that has gone backwards is
 * a control-plane bug, and truncating a tenant's filesystem is not a recoverable way to
 * discover it.
 */
export async function ensureDeviceFile({
  path,
  sizeBytes,
}: {
  path: string;
  sizeBytes: number;
}): Promise<number> {
  const target = alignToSector(sizeBytes);
  const current = await readDeviceFileSize({ path });
  if (current !== undefined && current > target) {
    throw new VolumeShrinkError({ current, requested: target });
  }
  if (current === target) {
    return target;
  }
  await mkdir(join(path, '..'), { recursive: true });
  const handle = await open(path, 'a');
  try {
    await handle.truncate(target);
  } finally {
    await handle.close();
  }
  return target;
}
