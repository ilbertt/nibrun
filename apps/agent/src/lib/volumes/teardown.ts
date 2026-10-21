import type { DesiredVolume, ReportedVolume } from '@repo/protocol';
import { Effect, Option } from 'effect';
import { AppZerofsFlushError } from '#lib/volumes/app-zerofs-durability.ts';
import { removeDeviceFile } from '#lib/volumes/device-file.ts';
import { detach, inspectAttachment } from '#lib/volumes/nbd.ts';
import type { ZerofsLiveFilesystem } from '#lib/volumes/topology.ts';
import { flush } from '#lib/volumes/zerofs.ts';
import { AppVolumeFiles } from '#services/app-volume-files.service.ts';
import { AppVolumeNbd } from '#services/app-volume-nbd.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';

const EMPTY_SIZE = 0;

export function deletedVolumeReport(
  desired: Pick<DesiredVolume, 'volumeId' | 'appId'>,
): ReportedVolume {
  return {
    volumeId: desired.volumeId,
    appId: desired.appId,
    state: 'deleted',
    sizeBytes: EMPTY_SIZE,
  };
}

/** Only for explicit deletion, with guest writes stopped and the assigned device on this filesystem. */
export function teardownVolume({
  desired,
  filesystem,
}: {
  desired: DesiredVolume;
  filesystem: ZerofsLiveFilesystem;
}) {
  return Effect.gen(function* () {
    yield* Effect.annotateCurrentSpan({ volumeId: desired.volumeId, appId: desired.appId });
    const allocator = yield* SlotAllocator;
    const slot = yield* allocator.lookup(desired.appId);
    const target = Option.map(slot, (assigned) => ({
      socketPath: filesystem.nbdSocketPath,
      devicePath: assigned.nbdDevicePath,
      volumeId: desired.volumeId,
    }));
    if (desired.storage !== undefined && Option.isSome(target)) {
      yield* inspectAttachment(target.value);
    }
    // With ignore_fsync, detaching before this barrier can lose acknowledged guest writes.
    yield* flush(filesystem.admin).pipe(
      Effect.mapError((error) =>
        desired.storage === undefined ? error : new AppZerofsFlushError(),
      ),
    );
    if (Option.isSome(slot)) {
      yield* desired.storage === undefined
        ? detach(slot.value.nbdDevicePath)
        : Effect.flatMap(AppVolumeNbd, (nbd) => nbd.detach(Option.getOrThrow(target)));
    }
    yield* desired.storage === undefined
      ? removeDeviceFile({ mount: filesystem.mountPath, volumeId: desired.volumeId })
      : Effect.flatMap(AppVolumeFiles, (files) =>
          files.remove({ mountPath: filesystem.mountPath, volumeId: desired.volumeId }),
        );
    // A configured writer retains its slot until service retirement is complete.
    if (desired.storage === undefined) {
      yield* allocator.release(desired.appId);
    }
    // The control plane finishes deleting the app on the strength of this report.
    return deletedVolumeReport(desired);
  });
}
