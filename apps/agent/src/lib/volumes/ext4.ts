import { FileSystem } from '@effect/platform';
import { Effect } from 'effect';
import { stdoutOf } from '#services/command-runner.service.ts';

const SUPERBLOCK_MAGIC_OFFSET = 1080;
const MAGIC_BYTE_COUNT = 2;
const EXT_MAGIC = 0xef53;
const HIGH_BYTE_SHIFT = 8;
const FIRST_BYTE = 0;
const SECOND_BYTE = 1;

export const FILESYSTEM_LABEL = 'nibrun-data';

/**
 * What `mkfs.ext4` below puts at the root of every filesystem it writes. A tenant did not create
 * these and has no use for them, so neither a listing nor an export shows them.
 *
 * **At the root only.** `lost+found` is reserved by the filesystem in exactly one directory; the
 * same name deeper in the tree is a directory a tenant made, and hiding it would be hiding their
 * own data from them.
 */
export const MKFS_ROOT_ENTRIES: ReadonlySet<string> = new Set(['lost+found']);

export function hasExtMagic(bytes: Uint8Array): boolean {
  if (bytes.length < MAGIC_BYTE_COUNT) {
    return false;
  }
  return ((bytes[FIRST_BYTE] ?? 0) | ((bytes[SECOND_BYTE] ?? 0) << HIGH_BYTE_SHIFT)) === EXT_MAGIC;
}

/**
 * Comparing a constant, not parsing a filesystem: the host must never let its kernel interpret
 * tenant-controlled metadata, and this is the only thing distinguishing a blank device.
 */
export const isFormatted = (devicePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const file = yield* fs.open(devicePath, { flag: 'r' });
        yield* file.seek(SUPERBLOCK_MAGIC_OFFSET, 'start');
        const buffer = new Uint8Array(MAGIC_BYTE_COUNT);
        yield* file.read(buffer);
        return hasExtMagic(buffer);
      }),
    );
  });

/** Writing a filesystem is not parsing one, so this stays on the host and the guest only mounts. */
export const formatOnce = Effect.fn('formatOnce')(function* (devicePath: string) {
  yield* Effect.annotateCurrentSpan({ devicePath });
  if (yield* isFormatted(devicePath)) {
    return false;
  }
  yield* stdoutOf({ command: ['mkfs.ext4', '-q', '-L', FILESYSTEM_LABEL, devicePath] });
  return true;
});
