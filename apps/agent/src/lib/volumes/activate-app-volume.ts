import type { DesiredVolume } from '@repo/protocol';
import { Effect, Option } from 'effect';
import { activateAppZerofs } from '#lib/volumes/app-zerofs-activation.ts';
import { APP_ZEROFS_CACHE } from '#lib/volumes/app-zerofs-cache.ts';
import { appZerofsFilesystem } from '#lib/volumes/app-zerofs-filesystem.ts';
import { readAppZerofsRetirement } from '#lib/volumes/app-zerofs-retirement.ts';
import { inspectAttachment } from '#lib/volumes/nbd.ts';
import { AppVolumeUnavailable, assertNoSharedVolume } from '#lib/volumes/placement.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';

/** Requires the control plane's exclusive fleet assignment of this bucket/prefix. */
export function activateAppVolume(desired: DesiredVolume) {
  return Effect.gen(function* () {
    if (desired.storage === undefined) {
      return;
    }
    if (desired.desiredState !== 'present') {
      return yield* new AppVolumeUnavailable();
    }
    if (Option.isSome(yield* readAppZerofsRetirement(desired.appId))) {
      return yield* new AppVolumeUnavailable();
    }
    const topology = yield* ZerofsTopology;
    if (Option.isSome(yield* topology.lookupAppFilesystem(desired.appId))) {
      yield* topology.resolveAppFilesystem({ appId: desired.appId, storage: desired.storage });
    }
    yield* assertNoSharedVolume(desired);
    const allocator = yield* SlotAllocator;
    const slot = yield* allocator.allocateWithNbdDevice(desired.appId);
    const filesystem = yield* appZerofsFilesystem({
      appId: desired.appId,
      storagePrefix: desired.storage.prefix,
    });
    yield* inspectAttachment({
      socketPath: filesystem.nbdSocketPath,
      devicePath: slot.nbdDevicePath,
      volumeId: desired.volumeId,
    });
    yield* activateAppZerofs({
      appId: desired.appId,
      storage: desired.storage,
      cache: APP_ZEROFS_CACHE,
    });
  }).pipe(Effect.asVoid);
}
