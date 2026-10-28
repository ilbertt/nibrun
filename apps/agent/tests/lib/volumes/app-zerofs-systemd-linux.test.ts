import { expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { FileSystem, Path } from '@effect/platform';
import { Effect, Layer, Option } from 'effect';
import { activateAppZerofs } from '#lib/volumes/app-zerofs-activation.ts';
import { APP_ZEROFS_CACHE } from '#lib/volumes/app-zerofs-cache.ts';
import { flushAndStopAppZerofs, flushAppZerofs } from '#lib/volumes/app-zerofs-durability.ts';
import { assertAppZerofsStopped, observeAppZerofs } from '#lib/volumes/app-zerofs-observation.ts';
import { assertMounted, devicePathFor } from '#lib/volumes/device-file.ts';
import { selectVolumeFilesystem } from '#lib/volumes/placement.ts';
import { AppVolumeFiles } from '#services/app-volume-files.service.ts';
import { AppVolumeNbd } from '#services/app-volume-nbd.service.ts';
import { AppZerofs } from '#services/app-zerofs.service.ts';
import { CommandRunner, stdoutOf } from '#services/command-runner.service.ts';
import { DesiredStateCache } from '#services/desired-state-cache.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { VolumeMigrationFences } from '#services/volume-migration-fences.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';
import {
  additionalAppZerofsInstance,
  appZerofsSystemdHost,
  emptySharedMount,
} from '#tests/support/app-zerofs-systemd.ts';
import { desiredVolume, VOLUME_SIZE_BYTES } from '#tests/support/fixtures.ts';
import { platform, provided } from '#tests/support/run.ts';
import { s3Backend } from '#tests/support/s3-backend.ts';
import { s3Storage } from '#tests/support/s3-storage.ts';

const TEST_TIMEOUT_MS = 300_000;
const PAYLOAD = 'data written through the actual per-app systemd mount';
const PRIVATE_FILE_MODE = 0o600;
const run = provided(CommandRunner.Default.pipe(Layer.provideMerge(platform)));

function unitPid(unit: string) {
  return stdoutOf({ command: ['systemctl', 'show', unit, '--property=MainPID', '--value'] }).pipe(
    Effect.map((value) => value.trim()),
  );
}

test.skipIf(process.platform !== 'linux' || process.env.NIBRUN_TEST_ZEROFS_SYSTEMD !== '1')(
  'a real migration destination starts and aborts without changing the shared source',
  async () => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const backend = yield* s3Backend();
        const host = yield* appZerofsSystemdHost(backend.certificate);
        const sharedMount = yield* emptySharedMount().pipe(Effect.provide(host.config));
        const dependencies = Layer.mergeAll(
          AppVolumeFiles.Default,
          AppVolumeNbd.DefaultWithoutDependencies,
          SlotAllocator.DefaultWithoutDependencies,
          ZerofsTopology.DefaultWithoutDependencies,
          VolumeMigrationFences.Default,
        ).pipe(
          Layer.provideMerge(
            DesiredStateCache.DefaultWithoutDependencies.pipe(Layer.provideMerge(host.config)),
          ),
        );
        const agent = AppZerofs.DefaultWithoutDependencies.pipe(Layer.provideMerge(dependencies));
        yield* Effect.gen(function* () {
          const files = yield* AppVolumeFiles;
          const app = yield* AppZerofs;
          const fences = yield* VolumeMigrationFences;
          const allocator = yield* SlotAllocator;
          const path = yield* Path.Path;
          const target = desiredVolume({ appId: host.appId, storage: backend.storage });
          yield* files.ensure({
            mountPath: sharedMount,
            volumeId: target.volumeId,
            sizeBytes: VOLUME_SIZE_BYTES,
          });
          const image = devicePathFor({ mount: sharedMount, volumeId: target.volumeId, path });
          const payload = new Uint8Array(VOLUME_SIZE_BYTES);
          payload.set(new TextEncoder().encode(PAYLOAD));
          yield* fs.writeFile(image, payload);
          yield* fences.during({
            appId: host.appId,
            effect: Effect.gen(function* () {
              const prepared = yield* app.prepareMigration(target);
              yield* assertMounted(prepared.destination.mountPath);
              const pid = yield* unitPid(host.units.server);
              expect(pid).not.toBe('0');
              expect(yield* app.prepareMigration(target)).toEqual(prepared);
              expect(yield* unitPid(host.units.server)).toBe(pid);
              expect(yield* fs.readFile(image)).toEqual(payload);
              expect(
                Option.isNone(
                  yield* files.size({
                    mountPath: prepared.destination.mountPath,
                    volumeId: target.volumeId,
                  }),
                ),
              ).toBe(true);
              expect(Option.isNone(yield* allocator.lookup(host.appId))).toBe(true);
              expect(yield* Effect.isFailure(app.ensure(target))).toBe(true);
              yield* app.abortMigration(target);
              yield* assertAppZerofsStopped(host.appId);
              expect(yield* fs.exists(dirname(host.paths.configFile))).toBe(false);
              expect(yield* fs.exists(host.paths.cacheDirectory)).toBe(false);
              expect(Option.isNone(yield* allocator.lookup(host.appId))).toBe(true);
              expect(yield* selectVolumeFilesystem({ ...target, storage: undefined })).toEqual(
                prepared.source,
              );
              expect(yield* fs.readFile(image)).toEqual(payload);
              yield* app.abortMigration(target);
              const retry = {
                ...target,
                storage: s3Storage({
                  ...backend.storage,
                  prefix: `${backend.storage.prefix}/retry`,
                }),
              };
              yield* app.prepareMigration(retry);
              yield* assertMounted(prepared.destination.mountPath);
              yield* app.abortMigration(retry);
              expect(yield* fs.readFile(image)).toEqual(payload);
            }),
          });
        }).pipe(
          Effect.provide(agent),
          Effect.onError(() => host.journal),
        );
      }).pipe(Effect.timeout('4 minutes')),
    );
  },
  TEST_TIMEOUT_MS,
);

test.skipIf(process.platform !== 'linux' || process.env.NIBRUN_TEST_ZEROFS_SYSTEMD !== '1')(
  'the installed per-app systemd templates activate, preserve their writer and stop cleanly',
  async () => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const backend = yield* s3Backend();
        const host = yield* appZerofsSystemdHost(backend.certificate);
        yield* Effect.gen(function* () {
          const activation = {
            appId: host.appId,
            storage: backend.storage,
            cache: APP_ZEROFS_CACHE,
          };
          const filesystem = yield* activateAppZerofs(activation);
          expect((yield* observeAppZerofs(host.appId)).ready).toBe(true);
          yield* assertMounted(filesystem.mountPath);
          const pid = yield* unitPid(host.units.server);
          expect(pid).not.toBe('0');
          const serviceUid = Number((yield* stdoutOf({ command: ['id', '-u', 'zerofs'] })).trim());
          expect(Option.getOrThrow((yield* fs.stat(`/proc/${pid}`)).uid)).toBe(serviceUid);
          const configuration = yield* fs.stat(host.paths.configFile);
          expect(configuration.mode & 0o777).toBe(PRIVATE_FILE_MODE);
          expect(Option.getOrThrow(configuration.uid)).toBe(0);
          expect((yield* fs.readFileString(`/proc/${pid}/cmdline`)).split('\0')).toContain(
            `/run/credentials/${host.units.server}/zerofs.toml`,
          );
          const marker = join(filesystem.mountPath, 'systemd-marker');
          yield* fs.writeFileString(marker, PAYLOAD);
          expect(yield* activateAppZerofs(activation)).toEqual(filesystem);
          expect(yield* unitPid(host.units.server)).toBe(pid);
          expect(yield* fs.readFileString(marker)).toBe(PAYLOAD);
          yield* flushAndStopAppZerofs(host.appId);
          yield* assertAppZerofsStopped(host.appId);
          expect(yield* Effect.isFailure(assertMounted(filesystem.mountPath))).toBe(true);
          expect(yield* fs.exists(dirname(host.paths.sockets.nbd))).toBe(false);
          expect(yield* fs.exists(host.paths.configFile)).toBe(true);
          expect(yield* fs.exists(host.paths.cacheDirectory)).toBe(true);
          yield* fs.remove(host.paths.cacheDirectory, { recursive: true });
          yield* activateAppZerofs(activation);
          expect(yield* unitPid(host.units.server)).not.toBe(pid);
          expect((yield* observeAppZerofs(host.appId)).ready).toBe(true);
          expect(yield* fs.readFileString(marker)).toBe(PAYLOAD);
          yield* flushAndStopAppZerofs(host.appId);
          yield* assertAppZerofsStopped(host.appId);
        }).pipe(
          Effect.onError(() => host.journal),
          Effect.provide(
            ZerofsTopology.DefaultWithoutDependencies.pipe(Layer.provideMerge(host.config)),
          ),
        );
      }).pipe(Effect.timeout('4 minutes')),
    );
  },
  TEST_TIMEOUT_MS,
);

test.skipIf(process.platform !== 'linux' || process.env.NIBRUN_TEST_ZEROFS_SYSTEMD !== '1')(
  'stopping and recovering one real app writer leaves another app mount and data usable',
  async () => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const backend = yield* s3Backend();
        const host = yield* appZerofsSystemdHost(backend.certificate);
        const peer = yield* additionalAppZerofsInstance();
        yield* Effect.gen(function* () {
          const firstStorage = backend.storage;
          const peerStorage = s3Storage({ ...backend.storage, prefix: 'apps/systemd-peer' });
          const firstActivation = {
            appId: host.appId,
            storage: firstStorage,
            cache: APP_ZEROFS_CACHE,
          };
          const first = yield* activateAppZerofs(firstActivation);
          const second = yield* activateAppZerofs({
            appId: peer.appId,
            storage: peerStorage,
            cache: APP_ZEROFS_CACHE,
          });
          const firstMarker = join(first.mountPath, 'isolation-marker');
          const secondMarker = join(second.mountPath, 'isolation-marker');
          const firstPayload = 'only the first app owns this data';
          const secondPayload = 'only the second app owns this data';
          yield* fs.writeFileString(firstMarker, firstPayload);
          yield* fs.writeFileString(secondMarker, secondPayload);
          expect(yield* fs.readFileString(firstMarker)).toBe(firstPayload);
          expect(yield* fs.readFileString(secondMarker)).toBe(secondPayload);
          const firstPid = yield* unitPid(host.units.server);
          const peerPids = yield* Effect.forEach(Object.values(peer.units), unitPid);
          expect(firstPid).not.toBe('0');
          expect(peerPids).not.toContain('0');
          yield* flushAppZerofs(peer.appId);
          yield* flushAndStopAppZerofs(host.appId);
          yield* assertAppZerofsStopped(host.appId);
          expect((yield* observeAppZerofs(peer.appId)).ready).toBe(true);
          expect(yield* Effect.forEach(Object.values(peer.units), unitPid)).toEqual(peerPids);
          expect(yield* fs.readFileString(secondMarker)).toBe(secondPayload);
          const continuedPayload = `${secondPayload}\nwritten while the first app is stopped`;
          yield* fs.writeFileString(secondMarker, continuedPayload);
          yield* flushAppZerofs(peer.appId);
          expect(yield* fs.readFileString(secondMarker)).toBe(continuedPayload);
          yield* fs.remove(host.paths.cacheDirectory, { recursive: true });
          yield* activateAppZerofs(firstActivation);
          expect(yield* unitPid(host.units.server)).not.toBe(firstPid);
          expect((yield* observeAppZerofs(host.appId)).ready).toBe(true);
          expect(yield* fs.readFileString(firstMarker)).toBe(firstPayload);
          expect(yield* Effect.forEach(Object.values(peer.units), unitPid)).toEqual(peerPids);
          expect((yield* observeAppZerofs(peer.appId)).ready).toBe(true);
          expect(yield* fs.readFileString(secondMarker)).toBe(continuedPayload);
          const afterRecoveryPayload = `${continuedPayload}\nwritten after the first app recovers`;
          yield* fs.writeFileString(secondMarker, afterRecoveryPayload);
          yield* flushAppZerofs(peer.appId);
          expect(yield* fs.readFileString(secondMarker)).toBe(afterRecoveryPayload);
          yield* flushAndStopAppZerofs(host.appId);
          yield* flushAndStopAppZerofs(peer.appId);
          yield* assertAppZerofsStopped(host.appId);
          yield* assertAppZerofsStopped(peer.appId);
        }).pipe(
          Effect.onError(() => Effect.all([host.journal, peer.journal])),
          Effect.provide(
            ZerofsTopology.DefaultWithoutDependencies.pipe(Layer.provideMerge(host.config)),
          ),
        );
      }).pipe(Effect.timeout('4 minutes')),
    );
  },
  TEST_TIMEOUT_MS,
);

test.skipIf(process.platform !== 'linux' || process.env.NIBRUN_TEST_ZEROFS_SYSTEMD !== '1')(
  'a fresh agent topology adopts the running app writer without shared-storage fallback',
  async () => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const backend = yield* s3Backend();
        const host = yield* appZerofsSystemdHost(backend.certificate);
        const agent = ZerofsTopology.DefaultWithoutDependencies.pipe(
          Layer.provideMerge(host.config),
        );
        const activation = { appId: host.appId, storage: backend.storage, cache: APP_ZEROFS_CACHE };
        const marker = join(host.paths.mountPath, 'agent-recovery-marker');
        const pids = Effect.forEach(Object.values(host.units), unitPid);
        yield* Effect.gen(function* () {
          const initial = yield* Effect.scoped(
            Effect.gen(function* () {
              const filesystem = yield* activateAppZerofs(activation);
              yield* fs.writeFileString(marker, PAYLOAD);
              const processes = yield* pids;
              expect(processes).not.toContain('0');
              return {
                filesystem,
                processes,
                configuration: yield* fs.readFileString(host.paths.configFile),
              };
            }).pipe(Effect.provide(Layer.fresh(agent))),
          );
          expect(yield* pids).toEqual(initial.processes);
          expect((yield* observeAppZerofs(host.appId)).ready).toBe(true);
          yield* Effect.scoped(
            Effect.gen(function* () {
              const topology = yield* ZerofsTopology;
              expect(Option.isNone(yield* topology.lookupAppFilesystem(host.appId))).toBe(true);
              expect(yield* topology.usesAppStorage(host.appId)).toBe(true);
              expect(yield* selectVolumeFilesystem(desiredVolume())).toEqual(topology.place());
              const refused = yield* selectVolumeFilesystem(
                desiredVolume({ appId: host.appId }),
              ).pipe(Effect.flip);
              expect(refused._tag).toBe('VolumeStorageConflict');
              expect(yield* pids).toEqual(initial.processes);
              expect(yield* fs.readFileString(marker)).toBe(PAYLOAD);
              expect(yield* activateAppZerofs(activation)).toEqual(initial.filesystem);
              expect(Option.getOrThrow(yield* topology.lookupAppFilesystem(host.appId))).toEqual(
                initial.filesystem,
              );
              expect(yield* pids).toEqual(initial.processes);
              expect(yield* fs.readFileString(host.paths.configFile)).toBe(initial.configuration);
              const recoveredPayload = `${PAYLOAD}\nwritten after registry recovery`;
              yield* fs.writeFileString(marker, recoveredPayload);
              expect(yield* fs.readFileString(marker)).toBe(recoveredPayload);
              yield* flushAndStopAppZerofs(host.appId);
              yield* assertAppZerofsStopped(host.appId);
            }).pipe(Effect.provide(Layer.fresh(agent))),
          );
        }).pipe(Effect.onError(() => host.journal));
      }).pipe(Effect.timeout('4 minutes')),
    );
  },
  TEST_TIMEOUT_MS,
);
