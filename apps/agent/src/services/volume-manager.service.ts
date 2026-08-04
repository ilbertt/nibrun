import { FileSystem, Path } from '@effect/platform';
import type { AppId, DesiredVolume, ReportedVolume, VolumeId } from '@repo/protocol';
import { Array as Arr, Effect, Option } from 'effect';
import type { AppSlot } from '#lib/network/slot.ts';
import type { ObservedVolume } from '#lib/reconcile/plan.ts';
import { devicePathFor, ensureDeviceFile, NBD_DIRECTORY } from '#lib/volumes/device-file.ts';
import { formatOnce } from '#lib/volumes/ext4.ts';
import { attach, detach, isAttached } from '#lib/volumes/nbd.ts';
import type { ZerofsFilesystem } from '#lib/volumes/topology.ts';
import { flush } from '#lib/volumes/zerofs.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';

const EMPTY_SIZE = 0;

export class VolumeManager extends Effect.Service<VolumeManager>()('VolumeManager', {
  effect: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const topology = yield* ZerofsTopology;
    const allocator = yield* SlotAllocator;

    const sizeOf = (filePath: string) =>
      fs.stat(filePath).pipe(
        Effect.map((info) =>
          info.type === 'File' ? Option.some(Number(info.size)) : Option.none<number>(),
        ),
        Effect.orElseSucceed(() => Option.none<number>()),
      );

    const slotFor = ({
      volumeId,
      appIdByVolume,
    }: {
      volumeId: VolumeId;
      appIdByVolume: ReadonlyMap<VolumeId, AppId>;
    }) =>
      Option.match(Option.fromNullable(appIdByVolume.get(volumeId)), {
        onNone: () => Effect.succeedNone,
        onSome: allocator.lookup,
      });

    const observeFile = ({
      filesystem,
      volumeId,
      slot,
    }: {
      filesystem: ZerofsFilesystem;
      volumeId: VolumeId;
      slot: Option.Option<AppSlot>;
    }) =>
      Effect.gen(function* () {
        const sizeBytes = yield* sizeOf(path.join(filesystem.mountPath, NBD_DIRECTORY, volumeId));
        if (Option.isNone(sizeBytes)) {
          return Option.none<ObservedVolume>();
        }
        const attached = Option.isSome(slot) ? yield* isAttached(slot.value.nbdDevicePath) : false;
        return Option.some<ObservedVolume>({
          volumeId,
          sizeBytes: sizeBytes.value,
          storagePrefix: filesystem.storagePrefix,
          attached,
          ...Option.match(slot, {
            onNone: () => ({}),
            onSome: (value) => ({ devicePath: value.nbdDevicePath }),
          }),
        });
      });

    /** The truth a restarted agent converges against: what ZeroFS is exporting, not what it remembers. */
    const observe = Effect.fn('VolumeManager.observe')(
      (appIdByVolume: ReadonlyMap<VolumeId, AppId>) =>
        Effect.forEach(topology.all, (filesystem) =>
          Effect.gen(function* () {
            const directory = path.join(filesystem.mountPath, NBD_DIRECTORY);
            const names = yield* fs.readDirectory(directory).pipe(
              Effect.tapError((error) =>
                Effect.logWarning('zerofs nbd directory unreadable', error).pipe(
                  Effect.annotateLogs({ directory }),
                ),
              ),
              Effect.orElseSucceed(() => [] as string[]),
            );
            const observed = yield* Effect.forEach(names, (name) =>
              Effect.flatMap(slotFor({ volumeId: name as VolumeId, appIdByVolume }), (slot) =>
                observeFile({ filesystem, volumeId: name as VolumeId, slot }),
              ),
            );
            return Arr.getSomes(observed);
          }),
        ).pipe(Effect.map((byFilesystem) => byFilesystem.flat())),
    );

    const provision = Effect.fn('VolumeManager.provision')(function* (desired: DesiredVolume) {
      yield* Effect.annotateCurrentSpan({ volumeId: desired.volumeId, appId: desired.appId });
      const filesystem = topology.place();
      const slot = yield* allocator.allocate(desired.appId);
      const sizeBytes = yield* ensureDeviceFile({
        path: devicePathFor({ mount: filesystem.mountPath, volumeId: desired.volumeId, path }),
        sizeBytes: desired.sizeBytes,
      });

      if (!(yield* isAttached(slot.nbdDevicePath))) {
        yield* attach({
          socketPath: filesystem.nbdSocketPath,
          devicePath: slot.nbdDevicePath,
          volumeId: desired.volumeId,
        });
      }

      if (yield* formatOnce(slot.nbdDevicePath)) {
        yield* Effect.logInfo('volume formatted').pipe(
          Effect.annotateLogs({ volumeId: desired.volumeId, device: slot.nbdDevicePath }),
        );
      }

      return {
        volumeId: desired.volumeId,
        state: 'ready',
        sizeBytes,
        devicePath: slot.nbdDevicePath,
        storagePrefix: filesystem.storagePrefix,
      } satisfies ReportedVolume;
    });

    /**
     * The only path that destroys tenant data, and it runs only for an explicit `absent`. The
     * flush first, so the detach happens at a durability point rather than dropping whatever the
     * periodic flush had not yet uploaded.
     */
    const teardown = Effect.fn('VolumeManager.teardown')(function* (desired: DesiredVolume) {
      yield* Effect.annotateCurrentSpan({ volumeId: desired.volumeId, appId: desired.appId });
      const filesystem = topology.place();
      const slot = yield* allocator.lookup(desired.appId);
      yield* flush(filesystem.admin);
      if (Option.isSome(slot)) {
        yield* detach(slot.value.nbdDevicePath);
      }
      yield* fs.remove(
        devicePathFor({ mount: filesystem.mountPath, volumeId: desired.volumeId, path }),
        { force: true },
      );
      yield* allocator.release(desired.appId);
      return {
        volumeId: desired.volumeId,
        state: 'deleting',
        sizeBytes: EMPTY_SIZE,
      } satisfies ReportedVolume;
    });

    return { observe, provision, teardown };
  }),
  dependencies: [ZerofsTopology.Default, SlotAllocator.Default],
}) {}
