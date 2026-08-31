import { FileSystem, Path } from '@effect/platform';
import {
  type AppId,
  type DesiredVolume,
  type ReportedVolume,
  Value,
  type VolumeId,
  VolumeIdSchema,
} from '@repo/protocol';
import { Array as Arr, Effect, Option } from 'effect';
import type { AppSlot } from '#lib/network/slot.ts';
import type { ObservedVolume } from '#lib/reconcile/plan.ts';
import { devicePathFor, ensureDeviceFile, NBD_DIRECTORY } from '#lib/volumes/device-file.ts';
import { formatOnce } from '#lib/volumes/ext4.ts';
import { detach, isUsable, reattach } from '#lib/volumes/nbd.ts';
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
      appId,
      slot,
    }: {
      filesystem: ZerofsFilesystem;
      volumeId: VolumeId;
      appId: AppId;
      slot: Option.Option<AppSlot>;
    }) =>
      Effect.gen(function* () {
        const sizeBytes = yield* sizeOf(path.join(filesystem.mountPath, NBD_DIRECTORY, volumeId));
        if (Option.isNone(sizeBytes)) {
          return Option.none<ObservedVolume>();
        }
        // Whether the device *works*, not whether it has a client: this is what `planVolumes`
        // reads to decide a volume needs nothing done to it, so a device that lies here is one
        // nothing ever repairs.
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
            // A device file with no app is one this agent has lost its record of. Reporting it
            // under a guessed app would be worse than leaving it out: the control plane reads
            // these to decide a tenant's filesystem is gone.
            //
            // Concurrently, because what takes any time here is the liveness probe, and the
            // failure that makes it slow is one ZeroFS having gone — which is every volume on
            // this filesystem at once. Sequentially that is one probe ceiling per volume before
            // the host reports anything, and a host that reports nothing is a host the control
            // plane cannot see. The list is one device file per slot, so it is bounded by the
            // minors the kernel was given.
            const observed = yield* Effect.forEach(
              names,
              (name) =>
                Effect.gen(function* () {
                  const volumeId = Value.Parse(VolumeIdSchema, name);
                  const appId = appIdByVolume.get(volumeId);
                  if (appId === undefined) {
                    return Option.none<ObservedVolume>();
                  }
                  const slot = yield* slotFor({ volumeId, appIdByVolume });
                  return yield* observeFile({ filesystem, volumeId, appId, slot });
                }),
              { concurrency: 'unbounded' },
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

      if (!(yield* isUsable(slot.nbdDevicePath))) {
        yield* reattach({
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
        appId: desired.appId,
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
      // `deleted` rather than `deleting`: everything above has already happened, and the control
      // plane finishes deleting the app on the strength of this.
      return {
        volumeId: desired.volumeId,
        appId: desired.appId,
        state: 'deleted',
        sizeBytes: EMPTY_SIZE,
      } satisfies ReportedVolume;
    });

    return { observe, provision, teardown };
  }),
  dependencies: [ZerofsTopology.Default, SlotAllocator.Default],
}) {}
