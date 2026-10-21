import { Path } from '@effect/platform';
import type { DesiredVolume, ReportedVolume } from '@repo/protocol';
import { Effect, Option } from 'effect';
import { devicePathFor, ensureDeviceFile } from '#lib/volumes/device-file.ts';
import { format } from '#lib/volumes/ext4.ts';
import { inspectAttachment, isUsable, reattach } from '#lib/volumes/nbd.ts';
import { formatFromSeed } from '#lib/volumes/seed.ts';
import type { ZerofsLiveFilesystem } from '#lib/volumes/topology.ts';
import { AppVolumeFiles } from '#services/app-volume-files.service.ts';
import { AppVolumeNbd } from '#services/app-volume-nbd.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';

/** A usable assigned device must already belong to the selected filesystem. */
export function provisionVolume({
  desired,
  filesystem,
}: {
  desired: DesiredVolume;
  filesystem: ZerofsLiveFilesystem;
}) {
  return Effect.gen(function* () {
    yield* Effect.annotateCurrentSpan({ volumeId: desired.volumeId, appId: desired.appId });
    const path = yield* Path.Path;
    const allocator = yield* SlotAllocator;
    const slot = yield* desired.storage === undefined
      ? allocator.allocate(desired.appId)
      : allocator.allocateWithNbdDevice(desired.appId);
    const target = {
      socketPath: filesystem.nbdSocketPath,
      devicePath: slot.nbdDevicePath,
      volumeId: desired.volumeId,
    };
    const appDeviceMissing = desired.storage !== undefined && !(yield* inspectAttachment(target));
    const sizeBytes = yield* desired.storage === undefined
      ? ensureDeviceFile({
          path: devicePathFor({ mount: filesystem.mountPath, volumeId: desired.volumeId, path }),
          sizeBytes: desired.sizeBytes,
        })
      : Effect.flatMap(AppVolumeFiles, (files) =>
          files.ensure({
            mountPath: filesystem.mountPath,
            volumeId: desired.volumeId,
            sizeBytes: desired.sizeBytes,
          }),
        );

    if (appDeviceMissing || !(yield* isUsable(slot.nbdDevicePath))) {
      yield* desired.storage === undefined
        ? reattach(target)
        : Effect.flatMap(AppVolumeNbd, (nbd) => nbd.reattach(target));
    }

    // The archive is only ever read at format time; the guard there makes a seed apply once.
    const formatted = yield* desired.seed
      ? formatFromSeed({
          devicePath: slot.nbdDevicePath,
          volumeId: desired.volumeId,
          seed: desired.seed,
        })
      : format({ devicePath: slot.nbdDevicePath, seedDir: Option.none() });
    if (formatted) {
      yield* Effect.logInfo('volume formatted').pipe(
        Effect.annotateLogs({
          volumeId: desired.volumeId,
          device: slot.nbdDevicePath,
          seeded: desired.seed !== undefined,
        }),
      );
    }

    return {
      volumeId: desired.volumeId,
      appId: desired.appId,
      state: 'ready',
      sizeBytes,
      devicePath: slot.nbdDevicePath,
      storagePrefix: filesystem.storagePrefix,
    } satisfies ReportedVolume;
  });
}
