import { expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { FileSystem } from '@effect/platform';
import { Effect, Layer, Option } from 'effect';
import {
  readAppZerofsCacheDiskBytes,
  readAppZerofsCacheMemoryBytes,
} from '#lib/volumes/app-zerofs-cache.ts';
import { assertAppZerofsStopped } from '#lib/volumes/app-zerofs-observation.ts';
import { readAppZerofsRetirement } from '#lib/volumes/app-zerofs-retirement.ts';
import { inspectAttachment, isAttached } from '#lib/volumes/nbd.ts';
import { selectVolumeFilesystem } from '#lib/volumes/placement.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { AppVolumeFiles } from '#services/app-volume-files.service.ts';
import { AppVolumeNbd } from '#services/app-volume-nbd.service.ts';
import { AppZerofs } from '#services/app-zerofs.service.ts';
import { CommandRunner } from '#services/command-runner.service.ts';
import { DesiredStateCache } from '#services/desired-state-cache.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { VolumeMigrationFences } from '#services/volume-migration-fences.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';
import { appZerofsSystemdHost, emptySharedMount } from '#tests/support/app-zerofs-systemd.ts';
import { desiredVolume, VOLUME_SIZE_BYTES } from '#tests/support/fixtures.ts';
import { platform, provided } from '#tests/support/run.ts';
import { s3Backend } from '#tests/support/s3-backend.ts';
import { configuredZerofs } from '#tests/support/zerofs.ts';

const TEST_TIMEOUT_MS = 300_000;
const SHARED_MARKER = 'shared storage must survive private volume retirement';
const run = provided(
  Layer.merge(CommandRunner.Default, AppVolumeFiles.Default).pipe(Layer.provideMerge(platform)),
);

test.skipIf(process.platform !== 'linux' || process.env.NIBRUN_TEST_ZEROFS_SYSTEMD !== '1')(
  'real per-app retirement detaches NBD, reclaims local state and rejects stale starts after recovery',
  async () => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const files = yield* AppVolumeFiles;
        const backend = yield* s3Backend();
        const host = yield* appZerofsSystemdHost(backend.certificate);
        const sharedMount = yield* emptySharedMount().pipe(Effect.provide(host.config));
        const sharedMarker = join(sharedMount, 'shared-marker');
        yield* fs.writeFileString(sharedMarker, SHARED_MARKER);
        const present = desiredVolume({ appId: host.appId, storage: backend.storage });
        const absent = { ...present, desiredState: 'absent' as const };
        const dependencies = Layer.mergeAll(
          AppVolumeNbd.DefaultWithoutDependencies,
          VolumeMigrationFences.Default,
          ZerofsTopology.DefaultWithoutDependencies,
          SlotAllocator.DefaultWithoutDependencies,
        ).pipe(
          Layer.provideMerge(
            DesiredStateCache.DefaultWithoutDependencies.pipe(Layer.provideMerge(host.config)),
          ),
        );
        const agent = AppZerofs.DefaultWithoutDependencies.pipe(Layer.provideMerge(dependencies));
        yield* Effect.gen(function* () {
          const report = yield* Effect.scoped(
            Effect.gen(function* () {
              const app = yield* AppZerofs;
              const allocator = yield* SlotAllocator;
              const topology = yield* ZerofsTopology;
              const nbd = yield* AppVolumeNbd;
              yield* app.ensure(present);
              const filesystem = yield* topology.resolveAppFilesystem({
                appId: host.appId,
                storage: backend.storage,
              });
              const slot = Option.getOrThrow(yield* allocator.lookup(host.appId));
              const input = { mountPath: filesystem.mountPath, volumeId: present.volumeId };
              yield* files.ensure({ ...input, sizeBytes: VOLUME_SIZE_BYTES });
              const target = {
                socketPath: filesystem.nbdSocketPath,
                devicePath: slot.nbdDevicePath,
                volumeId: present.volumeId,
              };
              yield* Effect.addFinalizer(() => nbd.detach(target).pipe(Effect.orDie));
              yield* nbd.reattach(target);
              expect(yield* inspectAttachment(target)).toBe(true);
              yield* allocator.persist;
              const deleted = yield* app.retire(absent);
              expect(deleted.state).toBe('deleted');
              yield* assertAppZerofsStopped(host.appId);
              expect(yield* isAttached(slot.nbdDevicePath)).toBe(false);
              expect(Option.isNone(yield* allocator.lookup(host.appId))).toBe(true);
              expect(Option.isNone(yield* topology.lookupAppFilesystem(host.appId))).toBe(true);
              const receipt = Option.getOrThrow(yield* readAppZerofsRetirement(host.appId));
              expect(receipt.appId).toBe(host.appId);
              expect(receipt.volumeId).toBe(present.volumeId);
              expect(yield* fs.exists(host.paths.configFile)).toBe(true);
              expect(yield* fs.exists(host.paths.cacheDirectory)).toBe(true);
              return deleted;
            }).pipe(Effect.provide(Layer.fresh(agent))),
          );
          const recovered = yield* configuredZerofs(backend);
          yield* recovered.run(
            Effect.gen(function* () {
              expect(
                Option.isNone(
                  yield* files.size({
                    mountPath: recovered.paths.mountPath,
                    volumeId: present.volumeId,
                  }),
                ),
              ).toBe(true);
            }),
          );
          yield* Effect.scoped(
            Effect.gen(function* () {
              const app = yield* AppZerofs;
              const allocator = yield* SlotAllocator;
              const { stateDir } = yield* AgentConfig;
              expect(Option.isSome(yield* allocator.lookup(host.appId))).toBe(true);
              expect(yield* app.retire(absent)).toEqual(report);
              expect(Option.isNone(yield* allocator.lookup(host.appId))).toBe(true);
              yield* allocator.persist;
              yield* app.reclaim(new Set([host.appId]));
              expect(yield* fs.exists(host.paths.configFile)).toBe(true);
              expect(yield* fs.exists(host.paths.cacheDirectory)).toBe(true);
              expect(yield* readAppZerofsCacheMemoryBytes(stateDir)).toBeGreaterThan(0);
              expect(yield* readAppZerofsCacheDiskBytes(stateDir)).toBeGreaterThan(0);
              yield* app.reclaim(new Set());
              expect(yield* fs.exists(dirname(host.paths.configFile))).toBe(false);
              expect(yield* fs.exists(host.paths.cacheDirectory)).toBe(false);
              expect(yield* readAppZerofsCacheMemoryBytes(stateDir)).toBe(0);
              expect(yield* readAppZerofsCacheDiskBytes(stateDir)).toBe(0);
              expect(Option.getOrThrow(yield* readAppZerofsRetirement(host.appId)).cleaned).toBe(
                true,
              );
            }).pipe(Effect.provide(Layer.fresh(agent))),
          );
          yield* backend.stop;
          yield* Effect.scoped(
            Effect.gen(function* () {
              const app = yield* AppZerofs;
              const topology = yield* ZerofsTopology;
              expect(yield* app.retire(absent)).toEqual(report);
              expect(Option.isNone(yield* (yield* SlotAllocator).lookup(host.appId))).toBe(true);
              expect(yield* topology.usesAppStorage(host.appId)).toBe(true);
              expect((yield* app.ensure(present).pipe(Effect.flip))._tag).toBe(
                'AppVolumeUnavailable',
              );
              expect(
                (yield* selectVolumeFilesystem({ ...present, storage: undefined }).pipe(
                  Effect.flip,
                ))._tag,
              ).toBe('VolumeStorageConflict');
              yield* app.reclaim(new Set());
              yield* assertAppZerofsStopped(host.appId);
              expect(yield* fs.exists(host.paths.configFile)).toBe(false);
              expect(yield* fs.exists(host.paths.cacheDirectory)).toBe(false);
              expect(yield* fs.readFileString(sharedMarker)).toBe(SHARED_MARKER);
            }).pipe(Effect.provide(Layer.fresh(agent))),
          );
        }).pipe(Effect.onError(() => host.journal));
      }).pipe(Effect.timeout('4 minutes')),
    );
  },
  TEST_TIMEOUT_MS,
);
