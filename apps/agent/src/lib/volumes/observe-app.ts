import type { DesiredVolume } from '@repo/protocol';
import { Effect, Option } from 'effect';
import type { ObservedVolume } from '#lib/reconcile/plan.ts';
import { isUsableFor } from '#lib/volumes/nbd.ts';
import { selectVolumeFilesystem } from '#lib/volumes/placement.ts';
import { AppVolumeFiles } from '#services/app-volume-files.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';

export function observeAppVolume(desired: DesiredVolume) {
  return Effect.gen(function* () {
    const filesystem = yield* selectVolumeFilesystem(desired);
    const files = yield* AppVolumeFiles;
    const size = yield* files.size({ mountPath: filesystem.mountPath, volumeId: desired.volumeId });
    if (Option.isNone(size)) {
      return [] as ObservedVolume[];
    }
    const allocator = yield* SlotAllocator;
    const slot = yield* allocator.lookup(desired.appId);
    const attached = Option.isSome(slot)
      ? yield* isUsableFor({
          socketPath: filesystem.nbdSocketPath,
          devicePath: slot.value.nbdDevicePath,
          volumeId: desired.volumeId,
        })
      : false;
    return [
      {
        volumeId: desired.volumeId,
        appId: desired.appId,
        sizeBytes: size.value,
        storagePrefix: filesystem.storagePrefix,
        attached,
        ...Option.match(slot, {
          onNone: () => ({}),
          onSome: (value) => ({ devicePath: value.nbdDevicePath }),
        }),
      } satisfies ObservedVolume,
    ];
  });
}
