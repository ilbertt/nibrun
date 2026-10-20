import { FileSystem, Path } from '@effect/platform';
import type { AppId, DesiredVolume, VolumeId } from '@repo/protocol';
import { Effect } from 'effect';
import { observeVolumes } from '#lib/volumes/observe.ts';
import { provisionVolume } from '#lib/volumes/provision.ts';
import { teardownVolume } from '#lib/volumes/teardown.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';

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

    const teardown = Effect.fn('VolumeManager.teardown')((desired: DesiredVolume) =>
      teardownVolume({ desired, filesystem: topology.place() }).pipe(
        Effect.provideService(SlotAllocator, allocator),
      ),
    );

    return { observe, provision, teardown };
  }),
  dependencies: [ZerofsTopology.Default, SlotAllocator.Default],
}) {}
