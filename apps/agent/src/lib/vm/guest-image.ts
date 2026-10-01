import { FileSystem, Path } from '@effect/platform';
import { Data, Effect } from 'effect';
import { readHostVersions } from '#lib/report/versions.ts';

export const GUEST_KERNEL_FILENAME = 'vmlinux';
export const GUEST_ROOTFS_FILENAME = 'rootfs.ext4';

export type GuestImage = {
  readonly version: string;
  readonly kernelPath: string;
  readonly rootfsPath: string;
};

export class GuestImageUnavailable extends Data.TaggedError('GuestImageUnavailable') {
  override get message() {
    return 'The adopted guest image is not installed consistently on this host.';
  }
}

export function adoptedGuestImage({
  versionsFile,
  guestImageDir,
}: {
  versionsFile: string;
  guestImageDir: string;
}) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const versions = yield* readHostVersions(versionsFile);
    const directory = yield* fs.realPath(guestImageDir);
    if (path.basename(directory) !== versions.guestImage) {
      return yield* new GuestImageUnavailable();
    }
    const kernelPath = yield* fs.realPath(path.join(directory, GUEST_KERNEL_FILENAME));
    const rootfsPath = yield* fs.realPath(path.join(directory, GUEST_ROOTFS_FILENAME));
    if (path.dirname(kernelPath) !== directory || path.dirname(rootfsPath) !== directory) {
      return yield* new GuestImageUnavailable();
    }
    return { version: versions.guestImage, kernelPath, rootfsPath } satisfies GuestImage;
  });
}
