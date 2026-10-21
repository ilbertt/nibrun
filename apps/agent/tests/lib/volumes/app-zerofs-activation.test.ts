import { describe, expect, test } from 'bun:test';
import { FileSystem, Path } from '@effect/platform';
import { SystemError } from '@effect/platform/Error';
import { Deferred, Effect, Either, Fiber, Layer, Option } from 'effect';
import { describeSlot, FIRST_SLOT } from '#lib/network/slot.ts';
import { APP_ZEROFS_CACHE } from '#lib/volumes/activate-app-volume.ts';
import { activateAppZerofs } from '#lib/volumes/app-zerofs-activation.ts';
import { appZerofsPaths } from '#lib/volumes/app-zerofs-config.ts';
import { appZerofsFilesystem } from '#lib/volumes/app-zerofs-filesystem.ts';
import { appZerofsUnits } from '#lib/volumes/app-zerofs-systemd.ts';
import { NBD_DIRECTORY } from '#lib/volumes/device-file.ts';
import { NbdAttachmentUnavailable } from '#lib/volumes/nbd.ts';
import { AppZerofs } from '#services/app-zerofs.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';
import { AGENT_CONFIG, agentConfig } from '#tests/support/config.ts';
import { APP_ID, desiredVolume, VOLUME_ID } from '#tests/support/fixtures.ts';
import { platform, provided, runScoped, temporaryDirectory } from '#tests/support/run.ts';
import { s3Storage } from '#tests/support/s3-storage.ts';
import { systemdUnitProperties as unit } from '#tests/support/systemd.ts';

const UNITS = appZerofsUnits(APP_ID);
const READY = `${unit({ id: UNITS.server })}\n\n${unit({ id: UNITS.mount })}`;
const ACTIVATING = `${unit({ id: UNITS.server })}\n\n${unit({ id: UNITS.mount, activeState: 'activating', subState: 'start-post' })}`;

function request() {
  return { appId: APP_ID, storage: s3Storage(), cache: { diskSizeGb: 4, memorySizeGb: 0.25 } };
}

function stagedConfig(overrides: Partial<FileSystem.FileSystem> = {}) {
  const written: string[] = [];
  const layer = FileSystem.layerNoop({
    makeDirectory: () => Effect.void,
    chmod: () => Effect.void,
    makeTempDirectoryScoped: () => Effect.succeed('/staging'),
    writeFileString: (...args) =>
      Effect.sync(() => {
        written.push(args[1]);
      }),
    link: () => Effect.void,
    ...overrides,
  });
  return { written, layer };
}

function host({
  commands,
  files,
  stateDir = '/var/lib/nibrun',
}: {
  commands: ReturnType<typeof recordingCommands>;
  files: ReturnType<typeof stagedConfig>;
  stateDir?: string;
}) {
  const config = agentConfig({ stateDir });
  return Layer.mergeAll(
    config,
    commands.layer,
    files.layer,
    ZerofsTopology.DefaultWithoutDependencies.pipe(Layer.provide(config)),
  );
}

function flushCommands(commands: ReturnType<typeof recordingCommands>) {
  return commands.commands
    .filter(({ command }) => command[1] === 'flush')
    .map(({ command }) => command);
}

function configuredHost({
  sharedImage = false,
  deviceAvailable = true,
  foreignAttachment = false,
  failure,
}: {
  sharedImage?: boolean;
  deviceAvailable?: boolean;
  foreignAttachment?: boolean;
  failure?: 'start' | 'unready';
} = {}) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const info = yield* fs.stat(yield* temporaryDirectory);
    const files = stagedConfig({
      stat: (value) =>
        Effect.succeed({
          ...info,
          dev: value === AGENT_CONFIG.zerofsMount ? info.dev + 1 : info.dev,
        }),
      exists: (value) =>
        Effect.succeed(
          sharedImage && value === path.join(AGENT_CONFIG.zerofsMount, NBD_DIRECTORY, VOLUME_ID),
        ),
      readFileString: (value) =>
        foreignAttachment && value.endsWith('/backend')
          ? Effect.succeed('')
          : Effect.fail(
              new SystemError({
                module: 'FileSystem',
                method: 'readFileString',
                reason: 'NotFound',
              }),
            ),
    });
    const commands = recordingCommands(({ command }) =>
      succeeding({
        code: failure === 'start' && command[1] === 'start' ? 1 : 0,
        stdout: command[1] === 'show' ? (failure === 'unready' ? ACTIVATING : READY) : '',
      }),
    );
    const allocations: string[] = [];
    const slot = describeSlot({ slot: FIRST_SLOT, appId: APP_ID });
    const allocator = Layer.succeed(
      SlotAllocator,
      SlotAllocator.make({
        allocate: () => Effect.die('configured activation requires an existing NBD device'),
        allocateWithNbdDevice: (appId) =>
          Effect.sync(() => {
            allocations.push(appId);
            return slot;
          }).pipe(
            Effect.filterOrFail(
              () => deviceAvailable,
              () => new NbdAttachmentUnavailable(),
            ),
          ),
        lookup: () => Effect.succeed(Option.some(slot)),
        slots: Effect.succeed([slot]),
        release: () => Effect.die('activation must not release a slot'),
        persist: Effect.void,
      }),
    );
    const layer = AppZerofs.DefaultWithoutDependencies.pipe(
      Layer.provideMerge(
        Layer.mergeAll(host({ commands, files }), allocator, Layer.succeed(Path.Path, path)),
      ),
    );
    return { files, commands, allocations, layer };
  });
}

describe('activation from configured desired volumes', () => {
  const run = provided(platform);

  test('starts and registers the app before provisioning and enrolls it in durability flushes once', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* configuredHost();
        yield* Effect.gen(function* () {
          const app = yield* AppZerofs;
          const topology = yield* ZerofsTopology;
          const desired = desiredVolume({ storage: s3Storage() });
          expect(Option.isNone(yield* topology.lookupAppFilesystem(APP_ID))).toBe(true);
          yield* app.ensure(desired);
          yield* app.ensure(desired);
          const beforeConflict = stage.commands.commands.length;
          const conflict = yield* Effect.either(
            app.ensure(
              desiredVolume({
                storage: s3Storage({ bucket: 'another-bucket' }),
              }),
            ),
          );
          expect(Either.isLeft(conflict) && conflict.left._tag).toBe('AppZerofsConfigConflict');
          expect(stage.commands.commands).toHaveLength(beforeConflict);
          expect(stage.files.written).toHaveLength(2);
          const filesystem = yield* topology.resolveAppFilesystem({
            appId: APP_ID,
            storage: s3Storage(),
          });
          yield* topology.flushAll;
          expect(flushCommands(stage.commands)).toEqual([
            [AGENT_CONFIG.zerofsBinary, 'flush', '-c', AGENT_CONFIG.zerofsConfigFile],
            [filesystem.admin.binary, 'flush', '-c', filesystem.admin.configFile],
          ]);
          for (const contents of stage.files.written) {
            expect(Bun.TOML.parse(contents)).toHaveProperty(
              'cache.memory_size_gb',
              APP_ZEROFS_CACHE.memorySizeGb,
            );
            expect(Bun.TOML.parse(contents)).toHaveProperty(
              'cache.disk_size_gb',
              APP_ZEROFS_CACHE.diskSizeGb,
            );
          }
          expect(
            stage.commands.commands
              .filter(({ command }) => command[1] === 'start')
              .map(({ command }) => command),
          ).toEqual([
            ['systemctl', 'start', UNITS.mount],
            ['systemctl', 'start', UNITS.mount],
          ]);
        }).pipe(Effect.provide(stage.layer));
      }),
    );
  });

  test('an unconfigured volume never stages, allocates or starts anything', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* configuredHost();
        yield* Effect.flatMap(AppZerofs, (app) => app.ensure(desiredVolume())).pipe(
          Effect.provide(stage.layer),
        );
        expect(stage.files.written).toEqual([]);
        expect(stage.commands.commands).toEqual([]);
        expect(stage.allocations).toEqual([]);
      }),
    );
  });

  test.each([
    { options: { sharedImage: true }, tag: 'VolumeStorageConflict' },
    { options: { deviceAvailable: false }, tag: 'NbdAttachmentUnavailable' },
    { options: { foreignAttachment: true }, tag: 'NbdAttachmentMismatch' },
  ])('unsafe placement fails before staging or startup: %j', async ({ options, tag }) => {
    await run(
      Effect.gen(function* () {
        const stage = yield* configuredHost(options);
        const result = yield* Effect.flatMap(AppZerofs, (app) =>
          app.ensure(desiredVolume({ storage: s3Storage() })),
        ).pipe(Effect.either, Effect.provide(stage.layer));
        expect(Either.isLeft(result) && result.left._tag).toBe(tag);
        expect(stage.files.written).toEqual([]);
        expect(stage.commands.commands).toEqual([]);
      }),
    );
  });

  test('a request to delete a volume never activates its storage', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* configuredHost();
        const result = yield* Effect.flatMap(AppZerofs, (app) =>
          app.ensure(desiredVolume({ storage: s3Storage(), desiredState: 'absent' })),
        ).pipe(Effect.either, Effect.provide(stage.layer));
        expect(Either.isLeft(result) && result.left._tag).toBe('AppVolumeUnavailable');
        expect(stage.files.written).toEqual([]);
        expect(stage.commands.commands).toEqual([]);
        expect(stage.allocations).toEqual([]);
      }),
    );
  });

  test.each([
    { failure: 'start' as const, tag: 'AppZerofsUnitError' },
    { failure: 'unready' as const, tag: 'AppZerofsNotReady' },
  ])(
    'an unsuccessful activation leaves no ready registration and never stops a writer: %j',
    async ({ failure, tag }) => {
      await run(
        Effect.gen(function* () {
          const stage = yield* configuredHost({ failure });
          yield* Effect.gen(function* () {
            const app = yield* AppZerofs;
            const result = yield* Effect.either(
              app.ensure(desiredVolume({ storage: s3Storage() })),
            );
            expect(Either.isLeft(result) && result.left._tag).toBe(tag);
            expect(Option.isNone(yield* (yield* ZerofsTopology).lookupAppFilesystem(APP_ID))).toBe(
              true,
            );
            expect(stage.files.written).toHaveLength(1);
            expect(
              stage.commands.commands.some(
                ({ command }) => command[1] === 'stop' || command[1] === 'restart',
              ),
            ).toBe(false);
          }).pipe(Effect.provide(stage.layer));
        }),
      );
    },
  );
});

describe('explicit per-app ZeroFS activation', () => {
  test('stages config and cache before starting, then registers the ready filesystem for flushes', async () => {
    const files = stagedConfig();
    const commands = recordingCommands((input) => {
      if (input.command[0] === 'install') {
        expect(files.written).toHaveLength(1);
      }
      return succeeding({ stdout: input.command[1] === 'show' ? READY : '' });
    });
    const filesystem = await provided(host({ commands, files }))(
      Effect.gen(function* () {
        const activated = yield* activateAppZerofs(request());
        const topology = yield* ZerofsTopology;
        yield* topology.flushAll;
        return activated;
      }),
    );
    const paths = appZerofsPaths({ appId: APP_ID, stateDir: '/var/lib/nibrun' });
    expect(filesystem).toEqual({
      storagePrefix: request().storage.prefix,
      mountPath: paths.mountPath,
      nbdSocketPath: paths.sockets.nbd,
      admin: { binary: AGENT_CONFIG.zerofsBinary, configFile: paths.configFile },
    });
    expect(commands.commands.map(({ command }) => command.slice(0, 2))).toEqual([
      ['mountpoint', '--quiet'],
      ['install', '--directory'],
      ['systemctl', 'start'],
      ['systemctl', 'show'],
      [AGENT_CONFIG.zerofsBinary, 'flush'],
      [AGENT_CONFIG.zerofsBinary, 'flush'],
    ]);
    expect(flushCommands(commands)).toEqual([
      [AGENT_CONFIG.zerofsBinary, 'flush', '-c', AGENT_CONFIG.zerofsConfigFile],
      [filesystem.admin.binary, 'flush', '-c', filesystem.admin.configFile],
    ]);
    expect(Bun.TOML.parse(files.written[0] ?? '')).toHaveProperty(
      'storage.url',
      's3://customer-data/apps/app-1',
    );
  });

  test('repeated activation enrolls the app in each later flush only once', async () => {
    const files = stagedConfig();
    const commands = recordingCommands((input) =>
      succeeding({ stdout: input.command[1] === 'show' ? READY : '' }),
    );
    await provided(host({ commands, files }))(
      Effect.gen(function* () {
        const filesystem = yield* activateAppZerofs(request());
        yield* activateAppZerofs(request());
        const topology = yield* ZerofsTopology;
        expect(topology.place().admin.configFile).toBe(AGENT_CONFIG.zerofsConfigFile);
        yield* topology.flushAll;
        expect(flushCommands(commands)).toEqual([
          [AGENT_CONFIG.zerofsBinary, 'flush', '-c', AGENT_CONFIG.zerofsConfigFile],
          [filesystem.admin.binary, 'flush', '-c', filesystem.admin.configFile],
        ]);
      }),
    );
  });

  test.each([
    { phase: 'start', tag: 'AppZerofsUnitError' },
    { phase: 'show', tag: 'AppZerofsObservationError' },
    { phase: 'activating', tag: 'AppZerofsNotReady' },
  ])('an unsuccessful activation never enrolls a new filesystem: %j', async ({ phase, tag }) => {
    const files = stagedConfig();
    const commands = recordingCommands((input) =>
      succeeding({
        code: input.command[1] === phase ? 1 : 0,
        stdout: phase === 'activating' ? ACTIVATING : READY,
      }),
    );
    await provided(host({ commands, files }))(
      Effect.gen(function* () {
        const result = yield* Effect.either(activateAppZerofs(request()));
        expect(Either.isLeft(result) && result.left._tag).toBe(tag);
        const topology = yield* ZerofsTopology;
        yield* topology.flushAll;
        expect(flushCommands(commands)).toEqual([
          [AGENT_CONFIG.zerofsBinary, 'flush', '-c', AGENT_CONFIG.zerofsConfigFile],
        ]);
      }),
    );
  });

  test('a registration conflict preserves the original entry and leaves the writer running', async () => {
    const files = stagedConfig();
    const commands = recordingCommands((input) =>
      succeeding({ stdout: input.command[1] === 'show' ? READY : '' }),
    );
    await provided(host({ commands, files }))(
      Effect.gen(function* () {
        const topology = yield* ZerofsTopology;
        const original = {
          appId: APP_ID,
          storage: s3Storage({ prefix: 'another/prefix' }),
          filesystem: yield* appZerofsFilesystem({
            appId: APP_ID,
            storagePrefix: s3Storage({ prefix: 'another/prefix' }).prefix,
          }),
        };
        yield* topology.registerAppFilesystem(original);
        const result = yield* Effect.either(activateAppZerofs(request()));
        expect(Either.isLeft(result) && result.left._tag).toBe('AppZerofsFilesystemConflict');
        yield* topology.registerAppFilesystem(original);
        expect(commands.commands.map(({ command }) => command.slice(0, 2))).toEqual([
          ['mountpoint', '--quiet'],
          ['install', '--directory'],
          ['systemctl', 'start'],
          ['systemctl', 'show'],
        ]);
      }),
    );
  });

  test('a mismatched credential path fails before staging or starting anything', async () => {
    const files = stagedConfig();
    const commands = recordingCommands();
    const result = await provided(host({ commands, files, stateDir: '/var/lib/another-agent' }))(
      Effect.either(activateAppZerofs(request())),
    );
    expect(Either.isLeft(result) && result.left._tag).toBe('AppZerofsConfigPathMismatch');
    expect(files.written).toEqual([]);
    expect(commands.commands).toEqual([]);
  });

  test('an unavailable data mount prevents both staging and startup', async () => {
    const files = stagedConfig();
    const commands = recordingCommands(() => succeeding({ code: 1 }));
    const result = await provided(host({ commands, files }))(
      Effect.either(activateAppZerofs(request())),
    );
    expect(Either.isLeft(result) && result.left._tag).toBe('AppZerofsCacheUnavailable');
    expect(files.written).toEqual([]);
    expect(commands.executables()).toEqual(['mountpoint']);
  });

  test('a cache preparation failure prevents startup and retains staged config', async () => {
    const files = stagedConfig();
    const commands = recordingCommands((input) =>
      succeeding({ code: input.command[0] === 'install' ? 1 : 0 }),
    );
    const result = await provided(host({ commands, files }))(
      Effect.either(activateAppZerofs(request())),
    );
    expect(Either.isLeft(result) && result.left._tag).toBe('AppZerofsCacheUnavailable');
    expect(files.written).toHaveLength(1);
    expect(commands.executables()).toEqual(['mountpoint', 'install']);
  });

  test('a conflicting config prevents cache changes and startup', async () => {
    const files = stagedConfig({
      link: () =>
        Effect.fail(
          new SystemError({ module: 'FileSystem', method: 'link', reason: 'AlreadyExists' }),
        ),
      readFileString: () => Effect.succeed('another configuration'),
    });
    const commands = recordingCommands();
    const result = await provided(host({ commands, files }))(
      Effect.either(activateAppZerofs(request())),
    );
    expect(Either.isLeft(result) && result.left._tag).toBe('AppZerofsConfigConflict');
    expect(commands.executables()).toEqual(['mountpoint']);
  });

  test('a failed start never stops an existing writer or exposes subprocess details', async () => {
    const files = stagedConfig();
    const commands = recordingCommands((input) =>
      succeeding({ code: input.command[1] === 'start' ? 1 : 0, stderr: 'customer-secret-key' }),
    );
    const result = await provided(host({ commands, files }))(
      Effect.either(activateAppZerofs(request())),
    );
    expect(Either.isLeft(result) && result.left._tag).toBe('AppZerofsUnitError');
    expect(JSON.stringify(result)).not.toContain('customer-secret-key');
    expect(commands.commands.map(({ command }) => command.slice(0, 2))).toEqual([
      ['mountpoint', '--quiet'],
      ['install', '--directory'],
      ['systemctl', 'start'],
    ]);
  });

  test('a mount still activating is rejected without stopping or removing storage', async () => {
    const files = stagedConfig();
    const commands = recordingCommands(() => succeeding({ stdout: ACTIVATING }));
    const result = await provided(host({ commands, files }))(
      Effect.either(activateAppZerofs(request())),
    );
    expect(Either.isLeft(result) && result.left._tag).toBe('AppZerofsNotReady');
    expect(files.written).toHaveLength(1);
    expect(commands.commands.map(({ command }) => command[1])).toEqual([
      '--quiet',
      '--directory',
      'start',
      'show',
    ]);
  });

  test('a failed readiness query retains the instance and reports an observation error', async () => {
    const files = stagedConfig();
    const commands = recordingCommands((input) =>
      succeeding({ code: input.command[1] === 'show' ? 1 : 0 }),
    );
    const result = await provided(host({ commands, files }))(
      Effect.either(activateAppZerofs(request())),
    );
    expect(Either.isLeft(result) && result.left._tag).toBe('AppZerofsObservationError');
    expect(commands.commands.map(({ command }) => command[1])).toEqual([
      '--quiet',
      '--directory',
      'start',
      'show',
    ]);
  });

  test('interruption after startup leaves the instance running', async () => {
    await runScoped(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const files = stagedConfig();
        const commands = recordingCommands((input) =>
          input.command[1] === 'show'
            ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never))
            : succeeding(),
        );
        yield* Effect.gen(function* () {
          const activation = yield* Effect.forkScoped(activateAppZerofs(request()));
          yield* Deferred.await(entered);
          yield* Fiber.interrupt(activation);
          expect(files.written).toHaveLength(1);
          expect(commands.commands.map(({ command }) => command[1])).toEqual([
            '--quiet',
            '--directory',
            'start',
            'show',
          ]);
          const topology = yield* ZerofsTopology;
          yield* topology.flushAll;
          expect(flushCommands(commands)).toEqual([
            [AGENT_CONFIG.zerofsBinary, 'flush', '-c', AGENT_CONFIG.zerofsConfigFile],
          ]);
        }).pipe(Effect.provide(host({ commands, files })));
      }),
    );
  });
});
