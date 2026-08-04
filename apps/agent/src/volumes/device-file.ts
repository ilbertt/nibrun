import { FileSystem, Path } from '@effect/platform';
import type { VolumeId } from '@repo/protocol';
import { Data, Effect, Option } from 'effect';

/** ZeroFS resolves every NBD export by looking this directory up on each negotiation. */
export const NBD_DIRECTORY = '.nbd';

/** Firecracker computes sectors as `size >> 9`, and leaves an unaligned tail invisible to the guest. */
const SECTOR_SIZE_BYTES = 512;

export const isSectorAligned = (sizeBytes: number) => sizeBytes % SECTOR_SIZE_BYTES === 0;

export const alignToSector = (sizeBytes: number) =>
  Math.ceil(sizeBytes / SECTOR_SIZE_BYTES) * SECTOR_SIZE_BYTES;

export const devicePathFor = ({
  mount,
  volumeId,
  path,
}: {
  mount: string;
  volumeId: VolumeId;
  path: Path.Path;
}) => path.join(mount, NBD_DIRECTORY, volumeId);

export class VolumeShrinkRefused extends Data.TaggedError('VolumeShrinkRefused')<{
  readonly current: number;
  readonly requested: number;
}> {
  override get message() {
    return `a volume of ${this.current} bytes cannot be resized down to ${this.requested}`;
  }
}

export const readDeviceFileSize = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.stat(path).pipe(
      Effect.map((info) => Option.some(Number(info.size))),
      Effect.orElseSucceed(() => Option.none<number>()),
    );
  });

/**
 * Growing preserves the data and shrinking discards everything past the new size, so a smaller
 * desired size is refused: truncating a tenant's filesystem is not a way to discover a bug.
 */
export const ensureDeviceFile = Effect.fn('ensureDeviceFile')(function* ({
  path,
  sizeBytes,
}: {
  path: string;
  sizeBytes: number;
}) {
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const target = alignToSector(sizeBytes);
  const current = yield* readDeviceFileSize(path);

  if (Option.isSome(current)) {
    if (current.value > target) {
      return yield* new VolumeShrinkRefused({ current: current.value, requested: target });
    }
    if (current.value === target) {
      return target;
    }
  }

  yield* fs.makeDirectory(pathService.dirname(path), { recursive: true });
  yield* Effect.scoped(
    Effect.flatMap(fs.open(path, { flag: 'a' }), (file) => file.truncate(target)),
  );
  return target;
});
