import { describe, expect, test } from 'bun:test';
import { basename, join } from 'node:path';
import { FileSystem } from '@effect/platform';
import { SystemError } from '@effect/platform/Error';
import { ObjectKeySchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect, Either, Layer, Option } from 'effect';
import { describeSlot, FIRST_SLOT } from '#lib/network/slot.ts';
import { NBD_DIRECTORY } from '#lib/volumes/device-file.ts';
import { provisionVolume } from '#lib/volumes/provision.ts';
import type { ZerofsLiveFilesystem } from '#lib/volumes/topology.ts';
import { AppVolumeFiles } from '#services/app-volume-files.service.ts';
import { AppVolumeNbd } from '#services/app-volume-nbd.service.ts';
import { AppZerofs } from '#services/app-zerofs.service.ts';
import { ArtifactStore, ArtifactTransferError } from '#services/artifact-store.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { VolumeManager } from '#services/volume-manager.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';
import { agentConfig, HOST_STORAGE_PREFIX } from '#tests/support/config.ts';
import {
  APP_ID,
  artifact,
  desiredVolume,
  VOLUME_ID,
  VOLUME_SIZE_BYTES,
} from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';
import { blankVolumeDevice, formattedVolumeDevice } from '#tests/support/volume-device.ts';

const run = provided(platform);

function host({
  formatted = false,
  usable = false,
  attachFails = false,
}: {
  formatted?: boolean;
  usable?: boolean;
  attachFails?: boolean;
} = {}) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* temporaryDirectory;
    const devicePath = join(directory, 'nbd0');
    yield* fs.writeFile(devicePath, formatted ? formattedVolumeDevice() : blankVolumeDevice());
    const slot = {
      ...describeSlot({ slot: FIRST_SLOT, appId: APP_ID }),
      nbdDevicePath: devicePath,
    };
    const allocations: string[] = [];
    const allocator = Layer.succeed(
      SlotAllocator,
      SlotAllocator.make({
        allocateWithNbdDevice: () => Effect.die('shared volumes must not inspect NBD availability'),
        allocate: (appId) =>
          Effect.sync(() => {
            allocations.push(appId);
            return slot;
          }),
        lookup: () => Effect.succeed(Option.some(slot)),
        release: () => Effect.void,
        slots: Effect.succeed([slot]),
        persist: Effect.void,
      }),
    );
    const commands = recordingCommands(({ command }) =>
      succeeding({
        code: attachFails && command[0] === 'nbd-client' ? 1 : 0,
      }),
    );
    const sysfs = `/sys/block/${basename(devicePath)}/`;
    const filesystemLayer = Layer.succeed(FileSystem.FileSystem, {
      ...fs,
      readFileString: (...args) => {
        const [path] = args;
        if (!path.startsWith(sysfs)) {
          return fs.readFileString(...args);
        }
        if (path.endsWith('/size')) {
          return Effect.succeed(usable ? '8\n' : '0\n');
        }
        return Effect.fail(
          new SystemError({ module: 'FileSystem', method: 'readFileString', reason: 'NotFound' }),
        );
      },
    });
    const downloads: string[] = [];
    const store = Layer.succeed(
      ArtifactStore,
      ArtifactStore.make({
        open: ({ objectKey }) =>
          Effect.sync(() => {
            downloads.push(objectKey);
          }).pipe(
            Effect.andThen(
              Effect.fail(new ArtifactTransferError({ cause: 'unexpected seed download' })),
            ),
          ),
      }),
    );
    const filesystem: ZerofsLiveFilesystem = {
      storagePrefix: Value.Parse(ObjectKeySchema, 'customer/app-1'),
      mountPath: join(directory, 'customer-mount'),
      nbdSocketPath: join(directory, 'customer.sock'),
      admin: { binary: '/test/zerofs', configFile: join(directory, 'customer.toml') },
    };
    const support = Layer.mergeAll(
      filesystemLayer,
      commands.layer,
      agentConfig(),
      store,
      AppVolumeFiles.Default.pipe(Layer.provide(filesystemLayer)),
      AppVolumeNbd.DefaultWithoutDependencies.pipe(Layer.provide(agentConfig())),
    );
    return {
      fs,
      directory,
      filesystem,
      slot,
      allocations,
      allocator,
      commands,
      downloads,
      support,
      layer: Layer.merge(support, allocator),
    };
  });
}

describe('provisioning on a selected live filesystem', () => {
  test('creates the image on that mount, connects its socket and reports its prefix', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host();
        const report = yield* provisionVolume({
          desired: desiredVolume(),
          filesystem: stage.filesystem,
        }).pipe(Effect.provide(stage.layer));
        const image = join(stage.filesystem.mountPath, NBD_DIRECTORY, VOLUME_ID);
        expect(Number((yield* stage.fs.stat(image)).size)).toBe(VOLUME_SIZE_BYTES);
        expect(stage.allocations).toEqual([APP_ID]);
        expect(report).toEqual({
          volumeId: VOLUME_ID,
          appId: APP_ID,
          state: 'ready',
          sizeBytes: VOLUME_SIZE_BYTES,
          devicePath: stage.slot.nbdDevicePath,
          storagePrefix: stage.filesystem.storagePrefix,
        });
        const attach = stage.commands.commands.find(({ command }) => command[0] === 'nbd-client');
        expect(attach?.command).toContain(stage.filesystem.nbdSocketPath);
        expect(attach?.command).toContain(stage.slot.nbdDevicePath);
        expect(attach?.command).toContain(VOLUME_ID);
        expect(stage.commands.executables()).toEqual(['nbd-client', 'mkfs.ext4']);
      }),
    );
  });

  test('a healthy formatted attachment is reused without reattachment or formatting', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host({ formatted: true, usable: true });
        yield* provisionVolume({ desired: desiredVolume(), filesystem: stage.filesystem }).pipe(
          Effect.provide(stage.layer),
        );
        expect(stage.commands.executables()).toEqual(['dd']);
      }),
    );
  });

  test('an already formatted seeded volume neither downloads nor overwrites the seed', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host({ formatted: true });
        yield* provisionVolume({
          desired: desiredVolume({ seed: artifact() }),
          filesystem: stage.filesystem,
        }).pipe(Effect.provide(stage.layer));
        expect(stage.downloads).toEqual([]);
        expect(stage.commands.executables()).toEqual(['nbd-client']);
      }),
    );
  });

  test('a larger existing image is not shrunk and no device is attached', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host();
        const image = join(stage.filesystem.mountPath, NBD_DIRECTORY, VOLUME_ID);
        yield* stage.fs.makeDirectory(join(stage.filesystem.mountPath, NBD_DIRECTORY), {
          recursive: true,
        });
        const originalSize = VOLUME_SIZE_BYTES * 2;
        yield* Effect.scoped(
          Effect.flatMap(stage.fs.open(image, { flag: 'w' }), (file) =>
            file.truncate(originalSize),
          ),
        );
        const result = yield* Effect.either(
          provisionVolume({ desired: desiredVolume(), filesystem: stage.filesystem }).pipe(
            Effect.provide(stage.layer),
          ),
        );
        expect(Either.isLeft(result) && result.left._tag).toBe('VolumeShrinkRefused');
        expect(Number((yield* stage.fs.stat(image)).size)).toBe(originalSize);
        expect(stage.commands.commands).toEqual([]);
      }),
    );
  });

  test('an attachment failure does not proceed to formatting or report success', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host({ attachFails: true });
        const result = yield* Effect.either(
          provisionVolume({ desired: desiredVolume(), filesystem: stage.filesystem }).pipe(
            Effect.provide(stage.layer),
          ),
        );
        expect(Either.isLeft(result) && result.left._tag).toBe('CommandFailed');
        expect(stage.commands.executables()).toEqual(['nbd-client']);
      }),
    );
  });

  test('the existing service still uses shared placement and its captured allocator', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host();
        const sharedConfig = agentConfig({
          zerofsMount: join(stage.directory, 'shared-mount'),
          zerofsNbdSocket: join(stage.directory, 'shared.sock'),
          zerofsStoragePrefix: HOST_STORAGE_PREFIX,
        });
        const topology = ZerofsTopology.DefaultWithoutDependencies.pipe(
          Layer.provide(sharedConfig),
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
                      reclaim: () => Effect.die('provisioning must not reclaim ZeroFS files'),
                      retire: () => Effect.die('provisioning must not retire ZeroFS'),
                      ensure: () => Effect.die('shared volumes must not activate ZeroFS'),
                    }),
                  ),
                ),
              ),
            ),
          ),
        );
        const report = yield* manager
          .provision(desiredVolume())
          .pipe(Effect.provide(stage.support));
        expect(report.storagePrefix).toBe(HOST_STORAGE_PREFIX);
        expect(stage.allocations).toEqual([APP_ID]);
        expect(
          yield* stage.fs.exists(join(stage.directory, 'shared-mount', NBD_DIRECTORY, VOLUME_ID)),
        ).toBe(true);
        expect(yield* stage.fs.exists(stage.filesystem.mountPath)).toBe(false);
        expect(
          stage.commands.commands.find(({ command }) => command[0] === 'nbd-client')?.command,
        ).toContain(join(stage.directory, 'shared.sock'));
      }),
    );
  });
});
