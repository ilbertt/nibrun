import { describe, expect, test } from 'bun:test';
import { basename, dirname, join } from 'node:path';
import { FileSystem, Path } from '@effect/platform';
import { SystemError } from '@effect/platform/Error';
import { AppIdSchema, type DesiredVolume, ObjectKeySchema, VolumeIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect, Either, Layer, Option } from 'effect';
import type { CommandLine } from '#lib/exec.ts';
import { describeSlot, FIRST_SLOT } from '#lib/network/slot.ts';
import { AppVolumeFileUnavailable } from '#lib/volumes/app-volume-file.ts';
import { appZerofsPaths } from '#lib/volumes/app-zerofs-config.ts';
import { ensureDeviceFile, NBD_DIRECTORY, removeDeviceFile } from '#lib/volumes/device-file.ts';
import { attachmentScope, NbdAttachmentUnavailable } from '#lib/volumes/nbd.ts';
import { AppVolumeUnavailable, selectVolumeFilesystem } from '#lib/volumes/placement.ts';
import { teardownVolume } from '#lib/volumes/teardown.ts';
import type { ZerofsLiveFilesystem } from '#lib/volumes/topology.ts';
import { AppVolumeFiles } from '#services/app-volume-files.service.ts';
import { AppVolumeNbd } from '#services/app-volume-nbd.service.ts';
import { AppZerofs } from '#services/app-zerofs.service.ts';
import { ArtifactStore } from '#services/artifact-store.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { VolumeManager } from '#services/volume-manager.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';
import { agentConfig, HOST_STORAGE_PREFIX } from '#tests/support/config.ts';
import { APP_ID, desiredVolume, VOLUME_ID, VOLUME_SIZE_BYTES } from '#tests/support/fixtures.ts';
import { privateNbdProcess } from '#tests/support/nbd.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';
import { s3Storage } from '#tests/support/s3-storage.ts';
import { formattedVolumeDevice } from '#tests/support/volume-device.ts';

const run = provided(platform);
const owners = new Map([[VOLUME_ID, APP_ID]]);
const OTHER_APP = Value.Parse(AppIdSchema, 'app-2');
const OTHER_VOLUME = Value.Parse(VolumeIdSchema, 'vol-2');
const APP_NBD_CLIENT = '/opt/nibrun/bin/app-nbd-client/nbd-client';

function host({
  registered = true,
  connection = 'none',
  mounted = true,
  supportsClient = true,
  deviceAvailable = true,
  canActivate = false,
}: {
  registered?: boolean;
  connection?: 'none' | 'shared' | 'private';
  mounted?: boolean;
  supportsClient?: boolean;
  deviceAvailable?: boolean;
  canActivate?: boolean;
} = {}) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const directory = yield* temporaryDirectory;
    const stateDir = join(directory, 'state');
    const slot = {
      ...describeSlot({ slot: FIRST_SLOT, appId: APP_ID }),
      nbdDevicePath: join(directory, 'nbd0'),
    };
    yield* fs.writeFile(slot.nbdDevicePath, formattedVolumeDevice());
    const filesystem: ZerofsLiveFilesystem = {
      storagePrefix: Value.Parse(ObjectKeySchema, 'customer/app-1'),
      mountPath: join(directory, 'private'),
      nbdSocketPath: join(directory, 'private.sock'),
      admin: { binary: '/test/zerofs', configFile: join(directory, 'private.toml') },
    };
    const sharedMount = join(directory, 'shared');
    for (const mount of [filesystem.mountPath, sharedMount]) {
      yield* fs.makeDirectory(join(mount, NBD_DIRECTORY), { recursive: true });
    }
    const target = {
      socketPath: filesystem.nbdSocketPath,
      devicePath: slot.nbdDevicePath,
      volumeId: VOLUME_ID,
    };
    let connected = connection !== 'none';
    let process = connection === 'private' ? privateNbdProcess(target) : undefined;
    function nbdExitCode(command: CommandLine) {
      if (!['nbd-client', APP_NBD_CLIENT, 'flock', 'systemctl'].includes(command[0])) {
        return 0;
      }
      if (command.includes('-d') || (command[0] === 'systemctl' && command[1] === 'stop')) {
        connected = false;
        process = undefined;
        return 0;
      }
      if (!supportsClient && command.includes('-nonetlink')) {
        return 1;
      }
      connected = true;
      process =
        command[0] === 'flock'
          ? {
              cmdline: `${command.slice(command.indexOf('--') + 1).join('\0')}\0`,
              cgroup: `0::/system.slice/${attachmentScope(target)}\n`,
            }
          : undefined;
      return 0;
    }
    const commands = recordingCommands(({ command }) =>
      Effect.sync(() => nbdExitCode(command)).pipe(Effect.flatMap((code) => succeeding({ code }))),
    );
    const sysfs = `/sys/block/${basename(slot.nbdDevicePath)}/`;
    function readAttribute(path: string) {
      const attributes: Record<string, string | undefined> = {
        [`${sysfs}size`]: connected ? '8\n' : '0\n',
        [`${sysfs}pid`]: connected ? '123\n' : undefined,
        '/proc/123/cmdline': process?.cmdline,
        '/proc/123/cgroup': process?.cgroup,
      };
      const value = attributes[path];
      return value === undefined
        ? Effect.fail(
            new SystemError({ module: 'FileSystem', method: 'readFileString', reason: 'NotFound' }),
          )
        : Effect.succeed(value);
    }
    const filesystemLayer = Layer.succeed(FileSystem.FileSystem, {
      ...fs,
      makeDirectory: (...args) =>
        args[0] === '/run/nibrun-nbd' ? Effect.void : fs.makeDirectory(...args),
      stat: (path) =>
        fs
          .stat(path)
          .pipe(
            Effect.map((info) =>
              path === sharedMount || (mounted && path === filesystem.mountPath)
                ? { ...info, dev: info.dev + 1 }
                : info,
            ),
          ),
      readFileString: (...args) =>
        args[0].startsWith(sysfs) || args[0].startsWith('/proc/123/')
          ? readAttribute(args[0])
          : fs.readFileString(...args),
    });
    let releases = 0;
    const allocations: string[] = [];
    const privateAllocations: string[] = [];
    const allocator = Layer.succeed(
      SlotAllocator,
      SlotAllocator.make({
        allocateWithNbdDevice: (appId) =>
          Effect.sync(() => {
            privateAllocations.push(appId);
            return slot;
          }).pipe(
            Effect.filterOrFail(
              () => deviceAvailable,
              () => new NbdAttachmentUnavailable(),
            ),
          ),
        allocate: (appId) =>
          Effect.sync(() => {
            allocations.push(appId);
            return slot;
          }),
        lookup: (appId) => Effect.succeed(appId === APP_ID ? Option.some(slot) : Option.none()),
        release: () =>
          Effect.sync(() => {
            releases += 1;
          }),
        slots: Effect.succeed([slot]),
        persist: Effect.void,
      }),
    );
    const config = agentConfig({
      stateDir,
      appVolumeNbdClient: APP_NBD_CLIENT,
      zerofsMount: sharedMount,
      zerofsNbdSocket: join(directory, 'shared.sock'),
      zerofsConfigFile: join(directory, 'shared.toml'),
    });
    const topology = yield* ZerofsTopology.pipe(
      Effect.provide(ZerofsTopology.DefaultWithoutDependencies.pipe(Layer.provide(config))),
    );
    const storage = s3Storage({ prefix: filesystem.storagePrefix });
    const activations: DesiredVolume[] = [];
    if (registered) {
      yield* topology.registerAppFilesystem({ appId: APP_ID, filesystem, storage });
    }
    const files = Layer.succeed(
      AppVolumeFiles,
      AppVolumeFiles.make({
        ensure: (input) =>
          ensureDeviceFile({
            path: join(input.mountPath, NBD_DIRECTORY, input.volumeId),
            sizeBytes: input.sizeBytes,
          }).pipe(
            Effect.provide(filesystemLayer),
            Effect.provideService(Path.Path, paths),
            Effect.mapError((error) =>
              error._tag === 'VolumeShrinkRefused' ? error : new AppVolumeFileUnavailable(),
            ),
          ),
        size: (input) =>
          fs.stat(join(input.mountPath, NBD_DIRECTORY, input.volumeId)).pipe(
            Effect.map((info) => Option.some(Number(info.size))),
            Effect.catchTag('SystemError', (error) =>
              error.reason === 'NotFound'
                ? Effect.succeedNone
                : Effect.fail(new AppVolumeFileUnavailable()),
            ),
            Effect.mapError(() => new AppVolumeFileUnavailable()),
          ),
        remove: (input) =>
          removeDeviceFile({ mount: input.mountPath, volumeId: input.volumeId }).pipe(
            Effect.provide(filesystemLayer),
            Effect.provideService(Path.Path, paths),
            Effect.mapError(() => new AppVolumeFileUnavailable()),
          ),
      }),
    );
    const retirementContext = yield* Layer.build(
      Layer.mergeAll(
        files,
        AppVolumeNbd.DefaultWithoutDependencies.pipe(Layer.provide(config)),
        filesystemLayer,
        Layer.succeed(Path.Path, paths),
        commands.layer,
        config,
        allocator,
        Layer.succeed(ZerofsTopology, topology),
      ),
    );
    const support = Layer.mergeAll(
      Layer.succeed(
        AppZerofs,
        AppZerofs.make({
          abortMigration: () => Effect.die('Normal lifecycle must not abort a migration.'),
          prepareMigration: () => Effect.die('Normal provisioning must not prepare a migration.'),
          reclaim: () => Effect.void,
          retire: (desired) =>
            Effect.gen(function* () {
              const selected = yield* selectVolumeFilesystem(desired);
              const report = yield* teardownVolume({ desired, filesystem: selected }).pipe(
                Effect.mapError(() => new AppVolumeUnavailable()),
              );
              yield* (yield* SlotAllocator).release(desired.appId);
              return report;
            }).pipe(Effect.provide(retirementContext)),
          ensure: (desired) =>
            Effect.gen(function* () {
              activations.push(desired);
              if (canActivate) {
                yield* topology.registerAppFilesystem({
                  appId: desired.appId,
                  filesystem,
                  storage,
                });
              }
              if (desired.storage !== undefined) {
                yield* topology.resolveAppFilesystem({
                  appId: desired.appId,
                  storage: desired.storage,
                });
              }
            }),
        }),
      ),
      files,
      AppVolumeNbd.DefaultWithoutDependencies.pipe(Layer.provide(config)),
      filesystemLayer,
      commands.layer,
      config,
      Layer.succeed(
        ArtifactStore,
        ArtifactStore.make({ open: () => Effect.die('unexpected seed download') }),
      ),
    );
    const manager = yield* VolumeManager.pipe(
      Effect.provide(
        VolumeManager.DefaultWithoutDependencies.pipe(
          Layer.provide(
            Layer.mergeAll(support, allocator, Layer.succeed(ZerofsTopology, topology)),
          ),
        ),
      ),
    );
    function image({
      mount,
      volumeId = VOLUME_ID,
    }: {
      mount: string;
      volumeId?: typeof VOLUME_ID;
    }) {
      return fs.writeFile(join(mount, NBD_DIRECTORY, volumeId), new Uint8Array(VOLUME_SIZE_BYTES));
    }
    return {
      fs,
      filesystem,
      sharedMount,
      slot,
      topology,
      manager,
      support,
      commands,
      allocations,
      privateAllocations,
      activations,
      storage,
      image,
      configDirectory: dirname(appZerofsPaths({ appId: APP_ID, stateDir }).configFile),
      released: () => releases,
    };
  });
}

describe('opt-in volume routing', () => {
  test.each(['provision', 'teardown'] as const)(
    'staged storage without a recovered registration blocks shared %s',
    async (operation) => {
      await run(
        Effect.gen(function* () {
          const stage = yield* host({ registered: false, connection: 'shared' });
          yield* stage.fs.makeDirectory(stage.configDirectory, { recursive: true });
          yield* stage.image({ mount: stage.sharedMount });
          const result = yield* operation === 'provision'
            ? stage.manager
                .provision(desiredVolume())
                .pipe(
                  Effect.match({ onFailure: (error) => error._tag, onSuccess: () => undefined }),
                  Effect.provide(stage.support),
                )
            : stage.manager
                .teardown(desiredVolume({ desiredState: 'absent' }))
                .pipe(
                  Effect.match({ onFailure: (error) => error._tag, onSuccess: () => undefined }),
                  Effect.provide(stage.support),
                );
          expect(result).toBe('VolumeStorageConflict');
          expect(stage.commands.commands).toEqual([]);
          expect(yield* stage.fs.exists(join(stage.sharedMount, NBD_DIRECTORY, VOLUME_ID))).toBe(
            true,
          );
        }),
      );
    },
  );

  test('staged storage cannot be discovered as shared after a restart', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host({ registered: false, connection: 'shared' });
        yield* stage.fs.makeDirectory(stage.configDirectory, { recursive: true });
        yield* stage.image({ mount: stage.sharedMount });
        yield* stage.image({ mount: stage.sharedMount, volumeId: OTHER_VOLUME });
        const observed = yield* stage.manager
          .observe({
            appIdByVolume: new Map([...owners, [OTHER_VOLUME, OTHER_APP]]),
            desiredVolumes: [desiredVolume()],
          })
          .pipe(Effect.provide(stage.support));
        expect(observed.map(({ volumeId }) => volumeId)).toEqual([OTHER_VOLUME]);
      }),
    );
  });

  test('a configured volume activates its filesystem before placement and provisioning', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host({ registered: false, canActivate: true });
        const wanted = desiredVolume({ storage: stage.storage });
        const report = yield* stage.manager.provision(wanted).pipe(Effect.provide(stage.support));
        expect(stage.activations).toEqual([wanted]);
        expect(report.storagePrefix).toBe(stage.filesystem.storagePrefix);
        expect(
          yield* stage.fs.exists(join(stage.filesystem.mountPath, NBD_DIRECTORY, VOLUME_ID)),
        ).toBe(true);
        expect(yield* stage.fs.exists(join(stage.sharedMount, NBD_DIRECTORY, VOLUME_ID))).toBe(
          false,
        );
      }),
    );
  });

  test('an unavailable NBD device stops configured provisioning before touching either filesystem', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host({ deviceAvailable: false });
        const provisioned = yield* stage.manager
          .provision(desiredVolume({ storage: stage.storage }))
          .pipe(Effect.either, Effect.provide(stage.support));
        expect(Either.isLeft(provisioned) && provisioned.left._tag).toBe('AppVolumeUnavailable');
        expect(stage.privateAllocations).toEqual([APP_ID]);
        expect(stage.allocations).toEqual([]);
        expect(stage.commands.commands).toEqual([]);
        for (const mount of [stage.sharedMount, stage.filesystem.mountPath]) {
          expect(yield* stage.fs.exists(join(mount, NBD_DIRECTORY, VOLUME_ID))).toBe(false);
        }
      }),
    );
  });

  test('an unconfigured volume still uses shared storage and the original NBD command', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host({ registered: false });
        const report = yield* stage.manager
          .provision(desiredVolume())
          .pipe(Effect.provide(stage.support));
        expect(report.storagePrefix).toBe(HOST_STORAGE_PREFIX);
        expect(stage.allocations).toEqual([APP_ID]);
        expect(stage.privateAllocations).toEqual([]);
        expect(stage.activations).toEqual([]);
        expect(yield* stage.fs.exists(join(stage.sharedMount, NBD_DIRECTORY, VOLUME_ID))).toBe(
          true,
        );
        expect(
          yield* stage.fs.exists(join(stage.filesystem.mountPath, NBD_DIRECTORY, VOLUME_ID)),
        ).toBe(false);
        expect(stage.commands.commands[0]?.command).not.toContain('-identifier');
        expect(stage.commands.commands[0]?.command[0]).toBe('nbd-client');
        yield* stage.manager
          .teardown(desiredVolume({ desiredState: 'absent' }))
          .pipe(Effect.provide(stage.support));
        expect(
          stage.commands.commands.find(({ command }) => command.includes('-d'))?.command,
        ).toEqual(['nbd-client', '-d', stage.slot.nbdDevicePath]);
      }),
    );
  });

  test('a configured volume is provisioned, discovered and removed only on its verified backend', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host();
        const wanted = desiredVolume({ storage: stage.storage });
        const report = yield* stage.manager.provision(wanted).pipe(Effect.provide(stage.support));
        expect(report.storagePrefix).toBe(stage.filesystem.storagePrefix);
        expect(stage.allocations).toEqual([]);
        expect(stage.privateAllocations).toEqual([APP_ID]);
        expect(stage.commands.commands[0]?.command).toContain(stage.filesystem.nbdSocketPath);
        expect(stage.commands.commands[0]?.command).toContain('-nonetlink');
        expect(stage.commands.commands[0]?.command).not.toContain('-identifier');
        expect(stage.commands.commands[0]?.command[0]).toBe('flock');
        expect(stage.commands.commands[0]?.command).toContain(APP_NBD_CLIENT);
        expect(yield* stage.fs.exists(join(stage.sharedMount, NBD_DIRECTORY, VOLUME_ID))).toBe(
          false,
        );
        const observed = yield* stage.manager
          .observe({ appIdByVolume: owners, desiredVolumes: [wanted] })
          .pipe(Effect.provide(stage.support));
        expect(observed).toHaveLength(1);
        expect(observed[0]?.attached).toBe(true);
        expect(observed[0]?.storagePrefix).toBe(stage.filesystem.storagePrefix);
        const deleted = yield* stage.manager
          .teardown({ ...wanted, desiredState: 'absent' })
          .pipe(Effect.provide(stage.support));
        expect(deleted.state).toBe('deleted');
        expect(
          stage.commands.commands.find(({ command }) => command[0] === 'systemctl')?.command,
        ).toEqual([
          'systemctl',
          'stop',
          attachmentScope({
            socketPath: stage.filesystem.nbdSocketPath,
            devicePath: stage.slot.nbdDevicePath,
            volumeId: VOLUME_ID,
          }),
        ]);
        expect(stage.released()).toBe(1);
        expect(
          yield* stage.fs.exists(join(stage.filesystem.mountPath, NBD_DIRECTORY, VOLUME_ID)),
        ).toBe(false);
        expect(
          stage.commands.commands
            .filter(({ command }) => command[1] === 'flush')
            .map(({ command }) => command.at(-1)),
        ).toEqual([stage.filesystem.admin.configFile]);
      }),
    );
  });

  test('an unavailable configured backend is never discovered, provisioned or deleted on shared storage', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host({ registered: false, connection: 'shared' });
        yield* stage.image({ mount: stage.sharedMount });
        const wanted = desiredVolume({ storage: stage.storage });
        expect(
          yield* stage.manager
            .observe({ appIdByVolume: owners, desiredVolumes: [wanted] })
            .pipe(Effect.provide(stage.support)),
        ).toEqual([]);
        const provisioned = yield* stage.manager
          .provision(wanted)
          .pipe(Effect.either, Effect.provide(stage.support));
        const removed = yield* stage.manager
          .teardown({ ...wanted, desiredState: 'absent' })
          .pipe(Effect.either, Effect.provide(stage.support));
        expect(Either.isLeft(provisioned) && provisioned.left._tag).toBe(
          'AppZerofsFilesystemUnavailable',
        );
        expect(Either.isLeft(removed) && removed.left._tag).toBe('AppZerofsFilesystemUnavailable');
        expect(stage.commands.commands).toEqual([]);
        expect(stage.allocations).toEqual([]);
        expect(stage.released()).toBe(0);
        expect(yield* stage.fs.exists(join(stage.sharedMount, NBD_DIRECTORY, VOLUME_ID))).toBe(
          true,
        );
      }),
    );
  });

  test('another bucket with the same prefix does not reuse the registered backend', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host();
        const wanted = desiredVolume({
          storage: s3Storage({ ...stage.storage, bucket: 'another-bucket' }),
        });
        const result = yield* Effect.either(
          stage.manager.provision(wanted).pipe(Effect.provide(stage.support)),
        );
        expect(Either.isLeft(result) && result.left._tag).toBe('AppZerofsConfigConflict');
        expect(stage.commands.commands).toEqual([]);
        expect(stage.allocations).toEqual([]);
      }),
    );
  });

  test('an existing shared image blocks migration and cannot appear ready as a configured volume', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host({ connection: 'shared' });
        yield* stage.image({ mount: stage.sharedMount });
        const wanted = desiredVolume({ storage: stage.storage });
        expect(
          yield* stage.manager
            .observe({ appIdByVolume: owners, desiredVolumes: [wanted] })
            .pipe(Effect.provide(stage.support)),
        ).toEqual([]);
        const result = yield* Effect.either(
          stage.manager.provision(wanted).pipe(Effect.provide(stage.support)),
        );
        expect(Either.isLeft(result) && result.left._tag).toBe('VolumeStorageConflict');
        expect(stage.commands.commands).toEqual([]);
      }),
    );
  });

  test('a healthy unidentified device is rejected before creating a private image', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host({ connection: 'shared' });
        const wanted = desiredVolume({ storage: stage.storage });
        const result = yield* Effect.either(
          stage.manager.provision(wanted).pipe(Effect.provide(stage.support)),
        );
        expect(Either.isLeft(result) && result.left._tag).toBe('AppVolumeUnavailable');
        expect(stage.commands.commands).toEqual([]);
        expect(
          yield* stage.fs.exists(join(stage.filesystem.mountPath, NBD_DIRECTORY, VOLUME_ID)),
        ).toBe(false);
      }),
    );
  });

  test.each([{ mounted: false }, { supportsClient: false }])(
    'an unusable host setup fails without falling back: %j',
    async (options) => {
      await run(
        Effect.gen(function* () {
          const stage = yield* host(options);
          const result = yield* Effect.either(
            stage.manager
              .provision(desiredVolume({ storage: stage.storage }))
              .pipe(Effect.provide(stage.support)),
          );
          expect(Either.isLeft(result)).toBe(true);
          expect(yield* stage.fs.exists(join(stage.sharedMount, NBD_DIRECTORY, VOLUME_ID))).toBe(
            false,
          );
          expect(
            stage.commands.commands.every(
              ({ command }) =>
                !command.includes('-unix') ||
                (command[0] === 'flock' &&
                  command.includes(APP_NBD_CLIENT) &&
                  command.includes(stage.filesystem.nbdSocketPath)),
            ),
          ).toBe(true);
        }),
      );
    },
  );

  test('discovery partitions owners so a private bucket cannot claim another app image', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host({ connection: 'private' });
        yield* stage.image({ mount: stage.filesystem.mountPath });
        yield* stage.image({ mount: stage.filesystem.mountPath, volumeId: OTHER_VOLUME });
        yield* stage.image({ mount: stage.sharedMount, volumeId: OTHER_VOLUME });
        yield* stage.fs.writeFileString(
          join(stage.filesystem.mountPath, NBD_DIRECTORY, 'not a volume!'),
          'unrelated',
        );
        const observed = yield* stage.manager
          .observe({
            appIdByVolume: new Map([...owners, [OTHER_VOLUME, OTHER_APP]]),
            desiredVolumes: [desiredVolume({ storage: stage.storage })],
          })
          .pipe(Effect.provide(stage.support));
        expect(
          observed.map(({ volumeId, storagePrefix }) => ({ volumeId, storagePrefix })),
        ).toEqual([
          { volumeId: OTHER_VOLUME, storagePrefix: HOST_STORAGE_PREFIX },
          { volumeId: VOLUME_ID, storagePrefix: stage.filesystem.storagePrefix },
        ]);
      }),
    );
  });

  test('dropping the configuration of a registered private app cannot silently select shared storage', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host({ connection: 'private' });
        const result = yield* Effect.either(
          stage.manager.provision(desiredVolume()).pipe(Effect.provide(stage.support)),
        );
        expect(Either.isLeft(result) && result.left._tag).toBe('VolumeStorageConflict');
        expect(stage.commands.commands).toEqual([]);
      }),
    );
  });
});
