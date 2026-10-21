import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { FileSystem } from '@effect/platform';
import { ObjectKeySchema, VolumeIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Deferred, Effect, Layer, Option } from 'effect';
import { describeSlot, FIRST_SLOT } from '#lib/network/slot.ts';
import { NBD_DIRECTORY } from '#lib/volumes/device-file.ts';
import { observeVolumes } from '#lib/volumes/observe.ts';
import type { ZerofsLiveFilesystem } from '#lib/volumes/topology.ts';
import { AppVolumeFiles } from '#services/app-volume-files.service.ts';
import { AppVolumeNbd } from '#services/app-volume-nbd.service.ts';
import { AppZerofs } from '#services/app-zerofs.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { VolumeManager } from '#services/volume-manager.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';
import { agentConfig, HOST_STORAGE_PREFIX } from '#tests/support/config.ts';
import { APP_ID, VOLUME_ID, VOLUME_SIZE_BYTES } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const run = provided(platform);
const owners = new Map([[VOLUME_ID, APP_ID]]);

function host({
  allocated = true,
  usable = true,
  probeFails = false,
}: {
  allocated?: boolean;
  usable?: boolean;
  probeFails?: boolean;
} = {}) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* temporaryDirectory;
    const filesystem: ZerofsLiveFilesystem = {
      storagePrefix: Value.Parse(ObjectKeySchema, 'customer/app-1'),
      mountPath: join(directory, 'customer-mount'),
      nbdSocketPath: join(directory, 'customer.sock'),
      admin: { binary: '/test/zerofs', configFile: join(directory, 'customer.toml') },
    };
    const imageDirectory = join(filesystem.mountPath, NBD_DIRECTORY);
    yield* fs.makeDirectory(imageDirectory, { recursive: true });
    yield* fs.writeFile(join(imageDirectory, VOLUME_ID), new Uint8Array(VOLUME_SIZE_BYTES));
    const slot = describeSlot({ slot: FIRST_SLOT, appId: APP_ID });
    const lookups: string[] = [];
    const allocator = Layer.succeed(
      SlotAllocator,
      SlotAllocator.make({
        allocateWithNbdDevice: () => Effect.die('observation must not allocate a slot'),
        allocate: () => Effect.die('observation must not allocate a slot'),
        lookup: (appId) =>
          Effect.sync(() => {
            lookups.push(appId);
            return allocated ? Option.some(slot) : Option.none();
          }),
        release: () => Effect.die('observation must not release a slot'),
        slots: Effect.succeed(allocated ? [slot] : []),
        persist: Effect.die('observation must not persist slots'),
      }),
    );
    const commands = recordingCommands(() => succeeding({ code: probeFails ? 1 : 0 }));
    const filesystemLayer = Layer.succeed(FileSystem.FileSystem, {
      ...fs,
      readFileString: (...args) =>
        args[0] === '/sys/block/nbd0/size'
          ? Effect.succeed(usable ? '8\n' : '0\n')
          : fs.readFileString(...args),
    });
    const support = Layer.mergeAll(
      filesystemLayer,
      commands.layer,
      AppVolumeFiles.Default.pipe(Layer.provide(filesystemLayer)),
      AppVolumeNbd.DefaultWithoutDependencies.pipe(Layer.provide(agentConfig())),
    );
    return {
      fs,
      directory,
      filesystem,
      imageDirectory,
      slot,
      lookups,
      commands,
      support,
      layer: Layer.merge(support, allocator),
    };
  });
}

describe('observation on a selected live filesystem', () => {
  test('discovers an existing image on that mount without provisioning it', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host();
        const otherMount = join(stage.directory, 'other-mount');
        yield* stage.fs.makeDirectory(join(otherMount, NBD_DIRECTORY), { recursive: true });
        yield* stage.fs.writeFile(join(otherMount, NBD_DIRECTORY, VOLUME_ID), new Uint8Array(1));
        const observed = yield* observeVolumes({
          filesystem: stage.filesystem,
          appIdByVolume: owners,
        }).pipe(Effect.provide(stage.layer));
        expect(observed).toEqual([
          {
            volumeId: VOLUME_ID,
            appId: APP_ID,
            sizeBytes: VOLUME_SIZE_BYTES,
            storagePrefix: stage.filesystem.storagePrefix,
            attached: true,
            devicePath: stage.slot.nbdDevicePath,
          },
        ]);
        expect(stage.lookups).toEqual([APP_ID]);
        expect(stage.commands.executables()).toEqual(['dd']);
        expect(stage.commands.commands[0]?.command).toContain(`if=${stage.slot.nbdDevicePath}`);
      }),
    );
  });

  test('ignores unknown owners, non-files and images that disappear before stat', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host();
        const nonFile = Value.Parse(VolumeIdSchema, 'vol-directory');
        const missing = Value.Parse(VolumeIdSchema, 'vol-missing');
        yield* stage.fs.makeDirectory(join(stage.imageDirectory, nonFile));
        yield* stage.fs.symlink(
          join(stage.directory, 'absent'),
          join(stage.imageDirectory, missing),
        );
        const observed = yield* observeVolumes({
          filesystem: stage.filesystem,
          appIdByVolume: new Map([
            [nonFile, APP_ID],
            [missing, APP_ID],
          ]),
        }).pipe(Effect.provide(stage.layer));
        expect(observed).toEqual([]);
        expect(stage.lookups).toEqual([APP_ID, APP_ID]);
        expect(stage.commands.commands).toEqual([]);
      }),
    );
  });

  test('an owner without a slot is reported detached without a device path or probe', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host({ allocated: false });
        const observed = yield* observeVolumes({
          filesystem: stage.filesystem,
          appIdByVolume: owners,
        }).pipe(Effect.provide(stage.layer));
        expect(observed[0]?.attached).toBe(false);
        expect(observed[0]).not.toHaveProperty('devicePath');
        expect(stage.commands.commands).toEqual([]);
      }),
    );
  });

  test.each([
    { usable: false, probeFails: false, probes: 0 },
    { usable: true, probeFails: true, probes: 1 },
  ])('an unusable device is reported detached: %j', async ({ usable, probeFails, probes }) => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host({ usable, probeFails });
        const observed = yield* observeVolumes({
          filesystem: stage.filesystem,
          appIdByVolume: owners,
        }).pipe(Effect.provide(stage.layer));
        expect(observed[0]?.attached).toBe(false);
        expect(observed[0]?.devicePath).toBe(stage.slot.nbdDevicePath);
        expect(stage.commands.commands).toHaveLength(probes);
      }),
    );
  });

  test('an unreadable image directory produces no observations or mutations', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host();
        yield* stage.fs.remove(stage.imageDirectory, { recursive: true });
        const observed = yield* observeVolumes({
          filesystem: stage.filesystem,
          appIdByVolume: owners,
        }).pipe(Effect.provide(stage.layer));
        expect(observed).toEqual([]);
        expect(stage.lookups).toEqual([]);
        expect(stage.commands.commands).toEqual([]);
        expect(yield* stage.fs.exists(stage.imageDirectory)).toBe(false);
      }),
    );
  });

  test('device probes run concurrently so one stalled device cannot delay the next probe', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host();
        const secondVolume = Value.Parse(VolumeIdSchema, 'vol-2');
        yield* stage.fs.writeFile(join(stage.imageDirectory, secondVolume), new Uint8Array(1));
        const bothStarted = yield* Deferred.make<void>();
        const commands = recordingCommands(() =>
          Effect.gen(function* () {
            if (commands.commands.length === 2) {
              yield* Deferred.succeed(bothStarted, undefined);
            }
            yield* Deferred.await(bothStarted);
            return yield* succeeding();
          }),
        );
        const observed = yield* observeVolumes({
          filesystem: stage.filesystem,
          appIdByVolume: new Map([...owners, [secondVolume, APP_ID]]),
        }).pipe(
          Effect.provide(commands.layer),
          Effect.provide(stage.layer),
          Effect.timeout('1 second'),
        );
        expect(observed).toHaveLength(2);
        expect(observed.every(({ attached }) => attached)).toBe(true);
        expect(commands.executables()).toEqual(['dd', 'dd']);
      }),
    );
  });

  test('the existing service still scans shared placement with its captured allocator', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host();
        const sharedMount = join(stage.directory, 'shared-mount');
        yield* stage.fs.makeDirectory(join(sharedMount, NBD_DIRECTORY), { recursive: true });
        yield* stage.fs.writeFile(join(sharedMount, NBD_DIRECTORY, VOLUME_ID), new Uint8Array(1));
        const topology = ZerofsTopology.DefaultWithoutDependencies.pipe(
          Layer.provide(
            agentConfig({ zerofsMount: sharedMount, zerofsStoragePrefix: HOST_STORAGE_PREFIX }),
          ),
        );
        const manager = yield* VolumeManager.pipe(
          Effect.provide(
            VolumeManager.DefaultWithoutDependencies.pipe(
              Layer.provide(
                Layer.mergeAll(
                  stage.layer,
                  topology,
                  Layer.succeed(
                    AppZerofs,
                    AppZerofs.make({
                      reclaim: () => Effect.die('observation must not reclaim ZeroFS files'),
                      retire: () => Effect.die('observation must not retire ZeroFS'),
                      ensure: () => Effect.die('observation must not activate ZeroFS'),
                    }),
                  ),
                ),
              ),
            ),
          ),
        );
        const observed = yield* manager
          .observe({ appIdByVolume: owners, desiredVolumes: [] })
          .pipe(Effect.provide(stage.support));
        expect(observed).toHaveLength(1);
        expect(observed[0]?.sizeBytes).toBe(1);
        expect(observed[0]?.storagePrefix).toBe(HOST_STORAGE_PREFIX);
        expect(observed[0]?.attached).toBe(true);
        expect(stage.lookups).toEqual([APP_ID]);
        expect(stage.commands.executables()).toEqual(['dd']);
      }),
    );
  });
});
