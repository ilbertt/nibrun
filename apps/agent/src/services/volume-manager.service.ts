import { FileSystem, Path } from '@effect/platform';
import type { AppId, DesiredVolume, ReportedVolume, VolumeId } from '@repo/protocol';
import { Effect, Option } from 'effect';
import { removeDeviceFile } from '#lib/volumes/device-file.ts';
import { detach } from '#lib/volumes/nbd.ts';
import { observeVolumes } from '#lib/volumes/observe.ts';
import { provisionVolume } from '#lib/volumes/provision.ts';
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

    /** The truth a restarted agent converges against: what ZeroFS is exporting, not what it remembers. */
    const observe = Effect.fn('VolumeManager.observe')(
      (appIdByVolume: ReadonlyMap<VolumeId, AppId>) =>
        Effect.forEach(topology.all, (filesystem) =>
          observeVolumes({ filesystem, appIdByVolume }),
        ).pipe(
          Effect.map((byFilesystem) => byFilesystem.flat()),
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
          Effect.provideService(SlotAllocator, allocator),
        ),
    );

    const provision = Effect.fn('VolumeManager.provision')((desired: DesiredVolume) =>
      provisionVolume({ desired, filesystem: topology.place() }).pipe(
        Effect.provideService(SlotAllocator, allocator),
      ),
    );

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
      yield* removeDeviceFile({ mount: filesystem.mountPath, volumeId: desired.volumeId });
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
