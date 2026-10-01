import { FileSystem, Path } from '@effect/platform';
import type { DeploymentId } from '@repo/protocol';
import { Data, Effect, Option } from 'effect';
import { readJsonFile } from '#lib/json-store.ts';
import { readHostVersions } from '#lib/report/versions.ts';

export const GUEST_KERNEL_FILENAME = 'vmlinux';
export const GUEST_ROOTFS_FILENAME = 'rootfs.ext4';
export const BOOTED_IMAGE_FILENAME = 'guest-image.json';

export type GuestImage = {
  readonly version: string;
  readonly kernelPath: string;
  readonly rootfsPath: string;
};

export type BootedGuestImage = GuestImage & { readonly deploymentId: DeploymentId };

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

export function readBootedGuestImage(workingDir: string) {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const stored = yield* readJsonFile(path.join(workingDir, BOOTED_IMAGE_FILENAME));
    const value = Option.getOrUndefined(stored) as Partial<BootedGuestImage> | undefined;
    if (
      value === null ||
      typeof value !== 'object' ||
      typeof value.version !== 'string' ||
      typeof value.deploymentId !== 'string' ||
      typeof value.kernelPath !== 'string' ||
      typeof value.rootfsPath !== 'string' ||
      !path.isAbsolute(value.rootfsPath) ||
      !path.isAbsolute(value.kernelPath) ||
      path.basename(path.dirname(value.rootfsPath)) !== value.version ||
      path.dirname(value.kernelPath) !== path.dirname(value.rootfsPath) ||
      path.basename(value.kernelPath) !== GUEST_KERNEL_FILENAME ||
      path.basename(value.rootfsPath) !== GUEST_ROOTFS_FILENAME
    ) {
      return Option.none<BootedGuestImage>();
    }
    return Option.some(value as BootedGuestImage);
  }).pipe(Effect.catchAll(() => Effect.succeedNone));
}
