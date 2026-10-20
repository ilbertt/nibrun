import { FileSystem, Path } from '@effect/platform';
import { type AppId, type VolumeId, VolumeIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Array as Arr, Effect, Option } from 'effect';
import type { AppSlot } from '#lib/network/slot.ts';
import type { ObservedVolume } from '#lib/reconcile/plan.ts';
import { NBD_DIRECTORY } from '#lib/volumes/device-file.ts';
import { isUsable } from '#lib/volumes/nbd.ts';
import type { ZerofsLiveFilesystem } from '#lib/volumes/topology.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';

function sizeOf(filePath: string) {
  return Effect.flatMap(FileSystem.FileSystem, (fs) => fs.stat(filePath)).pipe(
    Effect.map((info) =>
      info.type === 'File' ? Option.some(Number(info.size)) : Option.none<number>(),
    ),
    Effect.orElseSucceed(() => Option.none<number>()),
  );
}

function observeFile({
  filesystem,
  volumeId,
  appId,
  slot,
}: {
  filesystem: ZerofsLiveFilesystem;
  volumeId: VolumeId;
  appId: AppId;
  slot: Option.Option<AppSlot>;
}) {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const sizeBytes = yield* sizeOf(path.join(filesystem.mountPath, NBD_DIRECTORY, volumeId));
    if (Option.isNone(sizeBytes)) {
      return Option.none<ObservedVolume>();
    }
    // A client can outlive its ZeroFS connection; only a working device may skip repair.
    const attached = Option.isSome(slot) ? yield* isUsable(slot.value.nbdDevicePath) : false;
    return Option.some<ObservedVolume>({
      volumeId,
      appId,
      sizeBytes: sizeBytes.value,
      storagePrefix: filesystem.storagePrefix,
      attached,
      ...Option.match(slot, {
        onNone: () => ({}),
        onSome: (value) => ({ devicePath: value.nbdDevicePath }),
      }),
    });
  });
}

export function observeVolumes({
  filesystem,
  appIdByVolume,
}: {
  filesystem: ZerofsLiveFilesystem;
  appIdByVolume: ReadonlyMap<VolumeId, AppId>;
}) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const allocator = yield* SlotAllocator;
    const directory = path.join(filesystem.mountPath, NBD_DIRECTORY);
    const names = yield* fs.readDirectory(directory).pipe(
      Effect.tapError((error) =>
        Effect.logWarning('zerofs nbd directory unreadable', error).pipe(
          Effect.annotateLogs({ directory }),
        ),
      ),
      Effect.orElseSucceed(() => [] as string[]),
    );
    // Unknown owners cannot be guessed: the control plane uses these reports to place data.
    // Probe concurrently so a dead filesystem costs one timeout rather than one per volume.
    const observed = yield* Effect.forEach(
      names,
      (name) =>
        Effect.gen(function* () {
          const volumeId = Value.Parse(VolumeIdSchema, name);
          const appId = appIdByVolume.get(volumeId);
          if (appId === undefined) {
            return Option.none<ObservedVolume>();
          }
          const slot = yield* allocator.lookup(appId);
          return yield* observeFile({ filesystem, volumeId, appId, slot });
        }),
      { concurrency: 'unbounded' },
    );
    return Arr.getSomes(observed);
  });
}
