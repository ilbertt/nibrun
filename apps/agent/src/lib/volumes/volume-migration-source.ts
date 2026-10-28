import type { DesiredVolume } from '@repo/protocol';
import { Data, Effect, Option } from 'effect';
import { isSectorAligned } from '#lib/volumes/device-file.ts';
import { AppVolumeFiles } from '#services/app-volume-files.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';

export class VolumeMigrationSourceUnavailable extends Data.TaggedError(
  'VolumeMigrationSourceUnavailable',
) {
  override get message() {
    return 'The shared volume migration source is unavailable.';
  }
}

export function requireVolumeMigrationSource(desired: DesiredVolume) {
  return Effect.gen(function* () {
    const source = (yield* ZerofsTopology).place();
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
      return yield* new VolumeMigrationSourceUnavailable();
    }
    return source;
  });
}
