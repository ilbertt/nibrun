import { Buffer } from 'node:buffer';

const SUPERBLOCK_MAGIC_OFFSET = 1080;
const SUPERBLOCK_BYTES = 2048;
const EXT_MAGIC_LOW = 0x53;
const EXT_MAGIC_HIGH = 0xef;

export function blankVolumeDevice(): Buffer {
  return Buffer.alloc(SUPERBLOCK_BYTES);
}

export function formattedVolumeDevice(): Buffer {
  const device = blankVolumeDevice();
  device.set([EXT_MAGIC_LOW, EXT_MAGIC_HIGH], SUPERBLOCK_MAGIC_OFFSET);
  return device;
}
