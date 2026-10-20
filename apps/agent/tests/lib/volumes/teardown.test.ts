import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { FileSystem } from '@effect/platform';
import { SystemError } from '@effect/platform/Error';
import { ObjectKeySchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Deferred, Effect, Either, Fiber, Layer, Option } from 'effect';
import { CommandTimedOut } from '#lib/exec.ts';
import { describeSlot, FIRST_SLOT } from '#lib/network/slot.ts';
import { NBD_DIRECTORY } from '#lib/volumes/device-file.ts';
import { teardownVolume } from '#lib/volumes/teardown.ts';
import type { ZerofsLiveFilesystem } from '#lib/volumes/topology.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { VolumeManager } from '#services/volume-manager.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';
import { agentConfig, HOST_STORAGE_PREFIX } from '#tests/support/config.ts';
import { APP_ID, desiredVolume, VOLUME_ID } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const run = provided(platform);
const absent = desiredVolume({ desiredState: 'absent' });

function host({
  allocated = true,
  mounted = true,
  flushFails = false,
  detachTimesOut = false,
  removeFails = false,
}: {
  allocated?: boolean;
  mounted?: boolean;
  flushFails?: boolean;
  detachTimesOut?: boolean;
  removeFails?: boolean;
} = {}) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* temporaryDirectory;
    const filesystem: ZerofsLiveFilesystem = {
      storagePrefix: Value.Parse(ObjectKeySchema, 'customer/app-1'),
      mountPath: join(directory, 'customer-mount'),
      nbdSocketPath: join(directory, 'customer.sock'),
      admin: { binary: '/test/customer-zerofs', configFile: join(directory, 'customer.toml') },
    };
    const shared: ZerofsLiveFilesystem = {
      storagePrefix: HOST_STORAGE_PREFIX,
      mountPath: join(directory, 'shared-mount'),
      nbdSocketPath: join(directory, 'shared.sock'),
      admin: { binary: '/test/shared-zerofs', configFile: join(directory, 'shared.toml') },
    };
    const image = join(filesystem.mountPath, NBD_DIRECTORY, VOLUME_ID);
    const sharedImage = join(shared.mountPath, NBD_DIRECTORY, VOLUME_ID);
    for (const volumeFilesystem of [filesystem, shared]) {
      yield* fs.makeDirectory(join(volumeFilesystem.mountPath, NBD_DIRECTORY), { recursive: true });
      yield* fs.writeFileString(
        join(volumeFilesystem.mountPath, NBD_DIRECTORY, VOLUME_ID),
        'tenant bytes',
      );
    }
    const slot = describeSlot({ slot: FIRST_SLOT, appId: APP_ID });
    const events: string[] = [];
    const released: string[] = [];
    const allocator = Layer.succeed(
      SlotAllocator,
      SlotAllocator.make({
        allocate: () => Effect.die('teardown must not allocate a slot'),
        lookup: () =>
          Effect.sync(() => {
            events.push('lookup');
            return allocated ? Option.some(slot) : Option.none();
          }),
        release: (appId) =>
          Effect.sync(() => {
            events.push('release');
            released.push(appId);
          }),
        slots: Effect.succeed(allocated ? [slot] : []),
        persist: Effect.die('teardown must not persist slots'),
      }),
    );
    const commands = recordingCommands((request) =>
      Effect.gen(function* () {
        const operation = request.command[0] === 'nbd-client' ? 'detach' : 'flush';
        events.push(operation);
        if (operation === 'detach' && detachTimesOut) {
          return yield* new CommandTimedOut({ command: request.command });
        }
        return yield* succeeding({ code: operation === 'flush' && flushFails ? 1 : 0 });
      }),
    );
    const filesystemLayer = Layer.succeed(FileSystem.FileSystem, {
      ...fs,
      stat: (path) =>
        fs
          .stat(path)
          .pipe(
            Effect.map((info) =>
              mounted && [filesystem.mountPath, shared.mountPath].includes(path)
                ? { ...info, dev: info.dev + 1 }
                : info,
            ),
          ),
      remove: (...args) =>
        Effect.gen(function* () {
          events.push('remove');
          if (removeFails) {
            return yield* new SystemError({
              module: 'FileSystem',
              method: 'remove',
              reason: 'PermissionDenied',
            });
          }
          return yield* fs.remove(...args);
        }),
    });
    const support = Layer.merge(filesystemLayer, commands.layer);
    return {
      fs,
      filesystem,
      shared,
      image,
      sharedImage,
      slot,
      events,
      released,
      commands,
      support,
      layer: Layer.merge(support, allocator),
    };
  });
}

describe('teardown on a selected live filesystem', () => {
  test('flushes that backend before detaching, removes only its image, then releases the slot', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host();
        const report = yield* teardownVolume({
          desired: absent,
          filesystem: stage.filesystem,
        }).pipe(Effect.provide(stage.layer));
        expect(stage.events).toEqual(['lookup', 'flush', 'detach', 'remove', 'release']);
        expect(stage.commands.commands.map(({ command }) => command)).toEqual([
          [stage.filesystem.admin.binary, 'flush', '-c', stage.filesystem.admin.configFile],
          ['nbd-client', '-d', stage.slot.nbdDevicePath],
        ]);
        expect(yield* stage.fs.exists(stage.image)).toBe(false);
        expect(yield* stage.fs.readFileString(stage.sharedImage)).toBe('tenant bytes');
        expect(stage.released).toEqual([APP_ID]);
        expect(report).toEqual({
          volumeId: VOLUME_ID,
          appId: APP_ID,
          state: 'deleted',
          sizeBytes: 0,
        });
      }),
    );
  });

  test('an app without a slot still flushes and removes the image without detaching a device', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host({ allocated: false });
        yield* teardownVolume({ desired: absent, filesystem: stage.filesystem }).pipe(
          Effect.provide(stage.layer),
        );
        expect(stage.events).toEqual(['lookup', 'flush', 'remove', 'release']);
        expect(stage.commands.executables()).toEqual([stage.filesystem.admin.binary]);
        expect(yield* stage.fs.exists(stage.image)).toBe(false);
      }),
    );
  });

  test.each([
    { flushFails: true, tag: 'CommandFailed', events: ['lookup', 'flush'] },
    { detachTimesOut: true, tag: 'CommandTimedOut', events: ['lookup', 'flush', 'detach'] },
    { mounted: false, tag: 'NotMounted', events: ['lookup', 'flush', 'detach'] },
    { removeFails: true, tag: 'SystemError', events: ['lookup', 'flush', 'detach', 'remove'] },
  ])('an incomplete teardown keeps the image and slot: %j', async ({ tag, events, ...options }) => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host(options);
        const result = yield* Effect.either(
          teardownVolume({ desired: absent, filesystem: stage.filesystem }).pipe(
            Effect.provide(stage.layer),
          ),
        );
        expect(Either.isLeft(result) && result.left._tag).toBe(tag);
        expect(stage.events).toEqual([...events]);
        expect(stage.released).toEqual([]);
        expect(yield* stage.fs.readFileString(stage.image)).toBe('tenant bytes');
      }),
    );
  });

  test('interrupting a pending flush never detaches, deletes or releases during cleanup', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host();
        const entered = yield* Deferred.make<void>();
        const commands = recordingCommands(() =>
          Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
        );
        const teardown = yield* Effect.forkScoped(
          teardownVolume({ desired: absent, filesystem: stage.filesystem }).pipe(
            Effect.provide(commands.layer),
            Effect.provide(stage.layer),
          ),
        );
        yield* Deferred.await(entered);
        yield* Fiber.interrupt(teardown);
        expect(commands.executables()).toEqual([stage.filesystem.admin.binary]);
        expect(stage.events).toEqual(['lookup']);
        expect(stage.released).toEqual([]);
        expect(yield* stage.fs.readFileString(stage.image)).toBe('tenant bytes');
      }),
    );
  });

  test('the existing service still deletes from shared placement with its captured allocator', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host();
        const topology = ZerofsTopology.DefaultWithoutDependencies.pipe(
          Layer.provide(
            agentConfig({
              zerofsMount: stage.shared.mountPath,
              zerofsBinary: stage.shared.admin.binary,
              zerofsConfigFile: stage.shared.admin.configFile,
            }),
          ),
        );
        const manager = yield* VolumeManager.pipe(
          Effect.provide(
            VolumeManager.DefaultWithoutDependencies.pipe(
              Layer.provide(Layer.mergeAll(stage.layer, topology)),
            ),
          ),
        );
        const report = yield* manager.teardown(absent).pipe(Effect.provide(stage.support));
        expect(report.state).toBe('deleted');
        expect(stage.events).toEqual(['lookup', 'flush', 'detach', 'remove', 'release']);
        expect(stage.commands.commands[0]?.command).toEqual([
          stage.shared.admin.binary,
          'flush',
          '-c',
          stage.shared.admin.configFile,
        ]);
        expect(yield* stage.fs.exists(stage.sharedImage)).toBe(false);
        expect(yield* stage.fs.readFileString(stage.image)).toBe('tenant bytes');
        expect(stage.released).toEqual([APP_ID]);
      }),
    );
  });
});
