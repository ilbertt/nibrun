import { describe, expect, test } from 'bun:test';
import { FileSystem } from '@effect/platform';
import { SystemError } from '@effect/platform/Error';
import { Deferred, Effect, Either, Fiber, Layer } from 'effect';
import { activateAppZerofs } from '#lib/volumes/app-zerofs-activation.ts';
import { appZerofsPaths } from '#lib/volumes/app-zerofs-config.ts';
import { appZerofsFilesystem } from '#lib/volumes/app-zerofs-filesystem.ts';
import { appZerofsUnits } from '#lib/volumes/app-zerofs-systemd.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';
import { AGENT_CONFIG, agentConfig } from '#tests/support/config.ts';
import { APP_ID } from '#tests/support/fixtures.ts';
import { provided, runScoped } from '#tests/support/run.ts';
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
