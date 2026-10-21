import { FileSystem, Path } from '@effect/platform';
import type { AppId, DesiredVolume, VolumeId } from '@repo/protocol';
import { Effect } from 'effect';
import { observeVolumes } from '#lib/volumes/observe.ts';
import { observeAppVolume } from '#lib/volumes/observe-app.ts';
import { AppVolumeUnavailable, selectVolumeFilesystem } from '#lib/volumes/placement.ts';
import { provisionVolume } from '#lib/volumes/provision.ts';
import { teardownVolume } from '#lib/volumes/teardown.ts';
import { AppVolumeFiles } from '#services/app-volume-files.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';

export class VolumeManager extends Effect.Service<VolumeManager>()('VolumeManager', {
  effect: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const topology = yield* ZerofsTopology;
    const allocator = yield* SlotAllocator;
    const files = yield* AppVolumeFiles;

    /** The truth a restarted agent converges against: what ZeroFS is exporting, not what it remembers. */
    const observe = Effect.fn('VolumeManager.observe')(
      ({
        appIdByVolume,
        desiredVolumes,
      }: {
        appIdByVolume: ReadonlyMap<VolumeId, AppId>;
        desiredVolumes: readonly DesiredVolume[];
      }) =>
        Effect.gen(function* () {
          const configured = desiredVolumes.filter((volume) => volume.storage !== undefined);
          const guardedApps = new Set(configured.map((volume) => volume.appId));
          for (const appId of new Set(appIdByVolume.values())) {
            if ((yield* topology.lookupAppFilesystem(appId))._tag === 'Some') {
              guardedApps.add(appId);
            }
          }
          const sharedOwners = new Map(
            [...appIdByVolume].filter(([, appId]) => !guardedApps.has(appId)),
          );
          const shared = yield* Effect.forEach(topology.all, (filesystem) =>
            observeVolumes({ filesystem, appIdByVolume: sharedOwners }),
          );
          const appVolumes = yield* Effect.forEach(
            configured,
            (desired) => observeAppVolume(desired).pipe(Effect.catchAll(() => Effect.succeed([]))),
            { concurrency: 'unbounded' },
          );
          return [...shared.flat(), ...appVolumes.flat()];
        }).pipe(
          Effect.provideService(ZerofsTopology, topology),
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
          Effect.provideService(SlotAllocator, allocator),
          Effect.provideService(AppVolumeFiles, files),
        ),
    );

    const provision = Effect.fn('VolumeManager.provision')((desired: DesiredVolume) =>
      Effect.flatMap(selectVolumeFilesystem(desired), (filesystem) =>
        provisionVolume({ desired, filesystem }).pipe(
          Effect.mapError((error) =>
            desired.storage === undefined ? error : new AppVolumeUnavailable(),
          ),
        ),
      ).pipe(
        Effect.provideService(ZerofsTopology, topology),
        Effect.provideService(SlotAllocator, allocator),
        Effect.provideService(AppVolumeFiles, files),
      ),
    );

    const teardown = Effect.fn('VolumeManager.teardown')((desired: DesiredVolume) =>
      Effect.flatMap(selectVolumeFilesystem(desired), (filesystem) =>
        teardownVolume({ desired, filesystem }).pipe(
          Effect.mapError((error) =>
            desired.storage === undefined ? error : new AppVolumeUnavailable(),
          ),
        ),
      ).pipe(
        Effect.provideService(ZerofsTopology, topology),
        Effect.provideService(SlotAllocator, allocator),
        Effect.provideService(AppVolumeFiles, files),
      ),
    );

    return { observe, provision, teardown };
  }),
  dependencies: [ZerofsTopology.Default, SlotAllocator.Default, AppVolumeFiles.Default],
}) {}
