import type { DesiredVolume } from '@repo/protocol';
import { Data, Effect, Option } from 'effect';
import { activateAppZerofs } from '#lib/volumes/app-zerofs-activation.ts';
import { APP_ZEROFS_CACHE } from '#lib/volumes/app-zerofs-cache.ts';
import { readAppZerofsRetirement } from '#lib/volumes/app-zerofs-retirement.ts';
import { isSectorAligned } from '#lib/volumes/device-file.ts';
import type { VolumeImageCopyInput } from '#lib/volumes/volume-image-copy.ts';
import { AppVolumeFiles } from '#services/app-volume-files.service.ts';
import { VolumeMigrationFences } from '#services/volume-migration-fences.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';

export class VolumeMigrationDestinationUnavailable extends Data.TaggedError(
  'VolumeMigrationDestinationUnavailable',
) {
  override get message() {
    return 'The volume migration destination could not be prepared safely.';
  }
}

/** The coordinator retains its fence until cutover or destination cleanup; partial starts are not rolled back here. */
export function prepareVolumeMigration(desired: DesiredVolume) {
  return Effect.gen(function* () {
    if (desired.storage === undefined || desired.desiredState !== 'present') {
      return yield* new VolumeMigrationDestinationUnavailable();
    }
    yield* (yield* VolumeMigrationFences).requireHeld(desired.appId);
    if (Option.isSome(yield* readAppZerofsRetirement(desired.appId))) {
      return yield* new VolumeMigrationDestinationUnavailable();
    }
    const topology = yield* ZerofsTopology;
    if (Option.isSome(yield* topology.lookupAppFilesystem(desired.appId))) {
      yield* topology.resolveAppFilesystem({ appId: desired.appId, storage: desired.storage });
    }
    const source = topology.place();
    const size = yield* (yield* AppVolumeFiles).size({
      mountPath: source.mountPath,
      volumeId: desired.volumeId,
    });
    if (
      Option.isNone(size) ||
      size.value <= 0 ||
      !isSectorAligned(size.value) ||
      size.value !== desired.sizeBytes
    ) {
      return yield* new VolumeMigrationDestinationUnavailable();
    }
    const destination = yield* activateAppZerofs({
      appId: desired.appId,
      storage: desired.storage,
      cache: APP_ZEROFS_CACHE,
    });
    return {
      source,
      destination,
      volumeId: desired.volumeId,
      sizeBytes: desired.sizeBytes,
    } satisfies VolumeImageCopyInput;
  }).pipe(Effect.mapError(() => new VolumeMigrationDestinationUnavailable()));
}
