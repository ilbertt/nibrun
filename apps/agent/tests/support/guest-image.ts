import { FileSystem, Path } from '@effect/platform';
import { Effect } from 'effect';
import { writeJsonFile } from '#lib/json-store.ts';
import { GUEST_KERNEL_FILENAME, GUEST_ROOTFS_FILENAME } from '#lib/vm/guest-image.ts';
import { temporaryDirectory } from '#tests/support/run.ts';

export function installedGuestImage(version: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.realPath(yield* temporaryDirectory);
    const versionsFile = path.join(directory, 'versions.json');
    const guestImageDir = path.join(directory, 'current');
    function activate(nextVersion: string) {
      return Effect.gen(function* () {
        const root = path.join(directory, nextVersion);
        yield* fs.makeDirectory(root, { recursive: true });
        yield* fs.writeFileString(path.join(root, GUEST_KERNEL_FILENAME), 'kernel');
        yield* fs.writeFileString(path.join(root, GUEST_ROOTFS_FILENAME), 'rootfs');
        yield* fs.remove(guestImageDir, { force: true });
        yield* fs.symlink(root, guestImageDir);
        yield* writeJsonFile({
          path: versionsFile,
          value: {
            agent: 'abc1234',
            guestImage: nextVersion,
            zerofs: '0.5.0',
            firecracker: '1.16.1',
          },
        });
        return {
          version: nextVersion,
          kernelPath: path.join(root, GUEST_KERNEL_FILENAME),
          rootfsPath: path.join(root, GUEST_ROOTFS_FILENAME),
        };
      });
    }
    const image = yield* activate(version);
    return { directory, versionsFile, guestImageDir, image, activate };
  });
}
