import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { FileSystem } from '@effect/platform';
import { SystemError } from '@effect/platform/Error';
import { Effect, Layer } from 'effect';
import { NBD_DIRECTORY } from '#lib/volumes/device-file.ts';
import type { ZerofsLiveFilesystem } from '#lib/volumes/topology.ts';
import { VolumeImageCopier } from '#services/volume-image-copier.service.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';
import { HOST_STORAGE_PREFIX } from '#tests/support/config.ts';
import { VOLUME_ID } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const FAILURES = [
  'flush-before',
  'detach-exit',
  'pid-unreadable',
  'pid-unreadable-after',
  'pid-remains',
  'not-mounted',
  'not-block-device',
  'not-sysfs',
] as const;
type Scenario = (typeof FAILURES)[number] | 'ready' | 'already-detached' | 'flush-after';
const DEVICE = '/dev/nbd0';
const KERNEL_DEVICE = '/sys/block/nbd0';
const CONTENTS = 'the source filesystem must survive migration preparation';
const run = provided(platform);

function host(scenario: Scenario) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* temporaryDirectory;
    const source: ZerofsLiveFilesystem = {
      mountPath: join(directory, 'shared'),
      storagePrefix: HOST_STORAGE_PREFIX,
      nbdSocketPath: join(directory, 'nbd.sock'),
      admin: { binary: '/test/zerofs', configFile: join(directory, 'zerofs.toml') },
    };
    const image = join(source.mountPath, NBD_DIRECTORY, VOLUME_ID);
    yield* fs.makeDirectory(join(source.mountPath, NBD_DIRECTORY), { recursive: true });
    yield* fs.writeFileString(image, CONTENTS);
    const info = yield* fs.stat(directory);
    let attached = scenario !== 'already-detached';
    let flushes = 0;
    const commands = recordingCommands(({ command }) => {
      if (command[0] === source.admin.binary) {
        flushes += 1;
        return succeeding({
          code:
            (scenario === 'flush-before' && flushes === 1) ||
            (scenario === 'flush-after' && flushes === 2)
              ? 1
              : 0,
          stderr: 'private backend details',
        });
      }
      expect(command).toEqual(['nbd-client', '-d', DEVICE]);
      attached = scenario === 'pid-remains' || scenario === 'detach-exit';
      return succeeding({ code: scenario === 'detach-exit' ? 1 : 0 });
    });
    const filesystem = Layer.succeed(FileSystem.FileSystem, {
      ...fs,
      stat: (path) => {
        if (path === DEVICE) {
          return Effect.succeed({
            ...info,
            type: scenario === 'not-block-device' ? 'File' : 'BlockDevice',
          });
        }
        if (path === KERNEL_DEVICE) {
          return Effect.succeed({ ...info, type: scenario === 'not-sysfs' ? 'File' : 'Directory' });
        }
        return fs
          .stat(path)
          .pipe(
            Effect.map((stat) =>
              path === source.mountPath && scenario !== 'not-mounted'
                ? { ...stat, dev: stat.dev + 1 }
                : stat,
            ),
          );
      },
      readFileString: (...args) => {
        if (args[0] !== `${KERNEL_DEVICE}/pid`) {
          return fs.readFileString(...args);
        }
        const unreadable =
          scenario === 'pid-unreadable' || (scenario === 'pid-unreadable-after' && !attached);
        return unreadable || !attached
          ? Effect.fail(
              new SystemError({
                module: 'FileSystem',
                method: 'readFileString',
                reason: unreadable ? 'PermissionDenied' : 'NotFound',
              }),
            )
          : Effect.succeed('123\n');
      },
    });
    const copier = VolumeImageCopier.DefaultWithoutDependencies.pipe(
      Layer.provide(Layer.merge(filesystem, commands.layer)),
    );
    return {
      image,
      fs,
      source,
      commands: commands.commands,
      detach: Effect.flatMap(VolumeImageCopier, (service) =>
        service.detachSource({ source, devicePath: DEVICE }),
      ).pipe(Effect.provide(copier)),
    };
  });
}

test('migration flushes around a confirmed detach and preserves the source image across retries', () =>
  run(
    Effect.gen(function* () {
      const stage = yield* host('ready');
      yield* stage.detach;
      expect(stage.commands.map(({ command }) => command)).toEqual([
        [stage.source.admin.binary, 'flush', '-c', stage.source.admin.configFile],
        ['nbd-client', '-d', DEVICE],
        [stage.source.admin.binary, 'flush', '-c', stage.source.admin.configFile],
      ]);
      yield* stage.detach;
      expect(stage.commands.filter(({ command }) => command[0] === 'nbd-client')).toHaveLength(1);
      expect(yield* stage.fs.readFileString(stage.image)).toBe(CONTENTS);
    }),
  ));

test('a source already detached still crosses both durability barriers', () =>
  run(
    Effect.gen(function* () {
      const stage = yield* host('already-detached');
      yield* stage.detach;
      expect(stage.commands).toHaveLength(2);
      expect(stage.commands.every(({ command }) => command[0] === stage.source.admin.binary)).toBe(
        true,
      );
      expect(yield* stage.fs.readFileString(stage.image)).toBe(CONTENTS);
    }),
  ));

test.each(FAILURES)('migration refuses %s without deleting the source', (scenario) =>
  run(
    Effect.gen(function* () {
      const stage = yield* host(scenario);
      const result = yield* Effect.either(stage.detach);
      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('VolumeMigrationSourceDetachFailed');
        expect(result.left.message).not.toContain('private');
      }
      expect(yield* stage.fs.readFileString(stage.image)).toBe(CONTENTS);
      if (scenario === 'flush-before') {
        expect(stage.commands).toHaveLength(1);
      }
    }),
  ),
);

test('a failed final flush can be retried without reconnecting or discarding the source', () =>
  run(
    Effect.gen(function* () {
      const stage = yield* host('flush-after');
      expect(yield* Effect.isFailure(stage.detach)).toBe(true);
      yield* stage.detach;
      expect(stage.commands.filter(({ command }) => command[0] === 'nbd-client')).toHaveLength(1);
      expect(yield* stage.fs.readFileString(stage.image)).toBe(CONTENTS);
    }),
  ));
