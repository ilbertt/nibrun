import { open } from 'node:fs/promises';
import { type CommandRunner, runCommandOrThrow } from '#lib/exec.ts';

const SUPERBLOCK_MAGIC_OFFSET = 1080;
const MAGIC_BYTE_COUNT = 2;
const EXT_MAGIC = 0xef53;
const HIGH_BYTE_SHIFT = 8;
const FIRST_BYTE = 0;
const SECOND_BYTE = 1;

export const FILESYSTEM_LABEL = 'nibrun-data';

export function hasExtMagic(bytes: Uint8Array): boolean {
  if (bytes.length < MAGIC_BYTE_COUNT) {
    return false;
  }
  const low = bytes[FIRST_BYTE] ?? 0;
  const high = bytes[SECOND_BYTE] ?? 0;
  return (low | (high << HIGH_BYTE_SHIFT)) === EXT_MAGIC;
}

/**
 * Reads the two magic bytes of the ext superblock.
 *
 * This is comparing a constant, not parsing a filesystem: the host must never let its kernel
 * interpret tenant-controlled metadata, which is the rule the export design depends on, and
 * the only thing that distinguishes a blank device from one already provisioned.
 */
export async function isFormatted({ devicePath }: { devicePath: string }): Promise<boolean> {
  const handle = await open(devicePath, 'r');
  try {
    const buffer = new Uint8Array(MAGIC_BYTE_COUNT);
    await handle.read(buffer, FIRST_BYTE, MAGIC_BYTE_COUNT, SUPERBLOCK_MAGIC_OFFSET);
    return hasExtMagic(buffer);
  } finally {
    await handle.close();
  }
}

/**
 * Writes the filesystem exactly once, when the volume is provisioned.
 *
 * Writing a filesystem is not parsing one, so this stays on the host rather than in the guest,
 * and it keeps the guest runtime to mounting a device that is already valid.
 */
export async function formatOnce({
  runner,
  devicePath,
}: {
  runner: CommandRunner;
  devicePath: string;
}): Promise<boolean> {
  if (await isFormatted({ devicePath })) {
    return false;
  }
  await runCommandOrThrow({
    runner,
    request: {
      command: ['mkfs.ext4', '-q', '-L', FILESYSTEM_LABEL, devicePath],
    },
  });
  return true;
}
