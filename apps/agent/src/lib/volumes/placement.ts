import { FileSystem, Path } from '@effect/platform';
import type { DesiredVolume } from '@repo/protocol';
import { Data, Effect } from 'effect';
import { AppZerofsFilesystemUnavailable } from '#lib/volumes/app-zerofs-filesystem.ts';
import { assertMounted, devicePathFor } from '#lib/volumes/device-file.ts';
import { isUsableFor } from '#lib/volumes/nbd.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';

export class VolumeStorageConflict extends Data.TaggedError('VolumeStorageConflict') {
  override get message() {
    return 'The volume cannot change its storage backend on this host.';
  }
}

export class AppVolumeUnavailable extends Data.TaggedError('AppVolumeUnavailable') {
  override get message() {
    return 'The configured app volume is unavailable.';
  }
}

export class AppVolumeOperationUnavailable extends Data.TaggedError(
  'AppVolumeOperationUnavailable',
) {
  override get message() {
    return 'This operation is not available for configured app volumes on this host.';
  }
}

export function usesAppVolumeStorage(desired: Pick<DesiredVolume, 'appId' | 'storage'>) {
  return Effect.gen(function* () {
    if (desired.storage !== undefined) {
      return true;
    }
    const topology = yield* ZerofsTopology;
    return yield* topology.usesAppStorage(desired.appId);
  });
}

export function selectVolumeFilesystem(desired: DesiredVolume) {
  return Effect.gen(function* () {
    const topology = yield* ZerofsTopology;
    if (desired.storage === undefined) {
      if (yield* topology.usesAppStorage(desired.appId)) {
        return yield* new VolumeStorageConflict();
      }
      return topology.place();
    }
    const filesystem = yield* topology.resolveAppFilesystem({
      appId: desired.appId,
      storage: desired.storage,
    });
    yield* assertMounted(filesystem.mountPath).pipe(
      Effect.mapError(() => new AppZerofsFilesystemUnavailable()),
    );
    yield* assertNoSharedVolume(desired);
    return filesystem;
  });
}

export function assertNoSharedVolume(desired: Pick<DesiredVolume, 'volumeId'>) {
  return Effect.gen(function* () {
    const topology = yield* ZerofsTopology;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    for (const shared of topology.all) {
      yield* assertMounted(shared.mountPath).pipe(
        Effect.mapError(() => new AppZerofsFilesystemUnavailable()),
      );
      const exists = yield* fs
        .exists(devicePathFor({ mount: shared.mountPath, volumeId: desired.volumeId, path }))
        .pipe(Effect.mapError(() => new AppZerofsFilesystemUnavailable()));
      if (exists) {
        return yield* new VolumeStorageConflict();
      }
    }
  });
}

export function requireConfiguredVolume({
  desired,
  devicePath,
}: {
  desired: DesiredVolume;
  devicePath: string;
}) {
  return Effect.gen(function* () {
    const filesystem = yield* selectVolumeFilesystem(desired);
    if (
      !(yield* isUsableFor({
        socketPath: filesystem.nbdSocketPath,
        volumeId: desired.volumeId,
        devicePath,
      }))
    ) {
      return yield* new AppVolumeUnavailable();
    }
  });
}
