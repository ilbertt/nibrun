import { FileSystem } from '@effect/platform';
import { Data, Duration, Effect, Option } from 'effect';
import type { CommandLine } from '#lib/exec.ts';
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
 * The same ceiling the liveness probe carries, for the same reason: this opens a block device,
 * and one whose NBD server has gone answers neither the open nor the read.
 */
const SUPERBLOCK_READ_TIMEOUT_SECONDS = 15;
const SUPERBLOCK_READ_TIMEOUT = Duration.seconds(SUPERBLOCK_READ_TIMEOUT_SECONDS);

export class SuperblockUnreadable extends Data.TaggedError('SuperblockUnreadable')<{
  readonly devicePath: string;
}> {
  override get message() {
    return `${this.devicePath} did not answer a read of its superblock`;
  }
}

/**
 * Comparing a constant, not parsing a filesystem: the host must never let its kernel interpret
 * tenant-controlled metadata, and this is the only thing distinguishing a blank device.
 *
 * Raised rather than guessed when the device will not answer. Both guesses are wrong in a way
 * this is not allowed to be: unformatted destroys a tenant's filesystem, and formatted reports a
 * volume ready that nothing can read. A failure here is a volume reported failed, which is the
 * only one of the three an operator can act on.
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
    ).pipe(
      // As in `CommandRunner`: the read is on a thread this side cannot recall, so the deadline
      // has to be the moment this stops waiting rather than the moment the read gives up.
      Effect.disconnect,
      Effect.timeoutFail({
        duration: SUPERBLOCK_READ_TIMEOUT,
        onTimeout: () => new SuperblockUnreadable({ devicePath }),
      }),
    );
  });

/**
 * A seeded format writes a whole directory tree through NBD to a log-structured store in S3, where
 * an empty one writes almost nothing. What bounds it is the ceiling on the seed rather than
 * anything about mke2fs, so the deadline is the export's rather than a subprocess's default.
 */
const SEEDED_FORMAT_TIMEOUT = Duration.hours(1);

const mkfsCommand = ({
  devicePath,
  seedDir,
}: {
  devicePath: string;
  seedDir: Option.Option<string>;
}): CommandLine =>
  Option.match(seedDir, {
    onNone: (): CommandLine => ['mkfs.ext4', '-q', '-L', FILESYSTEM_LABEL, devicePath],
    onSome: (dir): CommandLine => [
      'mkfs.ext4',
      '-q',
      // The filesystem is created holding this tree, which is the only moment an app's data can be
      // put there without the host mounting a tenant filesystem.
      '-d',
      dir,
      '-L',
      FILESYSTEM_LABEL,
      devicePath,
    ],
  });

/**
 * Deliberately the defaults otherwise.
 *
 * Formatting an 8 GiB volume here measures 0.10s against a real ZeroFS, and ~0.09s of that is
 * recoverable only by `lazy_journal_init` — the one extended option that narrows what survives
 * an unclean shutdown. A log-structured store with compression is why: a fresh filesystem is
 * almost entirely zeroes, so what reaches S3 is a few hundred KiB whatever mke2fs is asked to
 * write. There is no time here worth buying.
 *
 * The guard is what makes a seed apply exactly once. A device that already carries a filesystem is
 * left alone whatever it was asked to be created from, so a flaky NBD cannot turn a redeploy into
 * a tenant's data being written over.
 */
export const format = Effect.fn('format')(function* ({
  devicePath,
  seedDir,
}: {
  devicePath: string;
  seedDir: Option.Option<string>;
}) {
  yield* Effect.annotateCurrentSpan({ devicePath, seeded: Option.isSome(seedDir) });
  if (yield* isFormatted(devicePath)) {
    return false;
  }
  yield* stdoutOf({
    command: mkfsCommand({ devicePath, seedDir }),
    ...(Option.isSome(seedDir) ? { timeout: SEEDED_FORMAT_TIMEOUT } : {}),
  });
  return true;
});
