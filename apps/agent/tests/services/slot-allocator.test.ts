import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { FileSystem } from '@effect/platform';
import { SystemError } from '@effect/platform/Error';
import { AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect, Either, Layer, Option } from 'effect';
import { describeSlot, FIRST_SLOT, SLOT_COUNT } from '#lib/network/slot.ts';
import { DesiredStateCache } from '#services/desired-state-cache.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { agentConfig } from '#tests/support/config.ts';
import { APP_ID, desiredState, desiredVolume } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';
import { s3Storage } from '#tests/support/s3-storage.ts';

const run = provided(platform);
const OTHER_APP = Value.Parse(AppIdSchema, 'app-2');
const LAST_SLOT = SLOT_COUNT - 1;

function host(devices: readonly number[]) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* temporaryDirectory;
    const info = yield* fs.stat(directory);
    const kernel = new Set(devices.map((slot) => `nbd${slot}`));
    const nodes = new Set(devices.map((slot) => `/dev/nbd${slot}`));
    const regular = new Set<string>();
    const denied = new Set<string>();
    const fakeFs: FileSystem.FileSystem = {
      ...fs,
      readDirectory: (...args) => {
        if (args[0] !== '/sys/block') {
          return fs.readDirectory(...args);
        }
        return denied.has(args[0])
          ? Effect.fail(
              new SystemError({
                module: 'FileSystem',
                method: 'readDirectory',
                reason: 'PermissionDenied',
              }),
            )
          : Effect.succeed([...kernel]);
      },
      stat: (path) => {
        if (!path.startsWith('/dev/nbd')) {
          return fs.stat(path);
        }
        if (denied.has(path) || !nodes.has(path)) {
          return Effect.fail(
            new SystemError({
              module: 'FileSystem',
              method: 'stat',
              reason: denied.has(path) ? 'PermissionDenied' : 'NotFound',
            }),
          );
        }
        return Effect.succeed({ ...info, type: regular.has(path) ? 'File' : 'BlockDevice' });
      },
    };
    const slotsFile = join(directory, 'slots.json');
    const slotCursorFile = join(directory, 'cursor.json');
    const config = agentConfig({
      slotsFile,
      slotCursorFile,
      desiredStateFile: join(directory, 'desired.json'),
    });
    const cache = yield* DesiredStateCache.pipe(
      Effect.provide(DesiredStateCache.DefaultWithoutDependencies.pipe(Layer.provide(config))),
    );
    const open = SlotAllocator.pipe(
      Effect.provide(
        SlotAllocator.DefaultWithoutDependencies.pipe(
          Layer.provide(Layer.succeed(DesiredStateCache, cache)),
          Layer.provide(Layer.merge(config, Layer.succeed(FileSystem.FileSystem, fakeFs))),
        ),
      ),
    );
    return { kernel, nodes, regular, denied, open, slotsFile, slotCursorFile, cache };
  });
}

describe('configured volumes require existing NBD devices', () => {
  test('boot, wake and idle allocations use the configured volume constraint too', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host([FIRST_SLOT]);
        yield* (yield* FileSystem.FileSystem).writeFileString(stage.slotCursorFile, `${LAST_SLOT}`);
        const allocator = yield* stage.open;
        yield* stage.cache.accept(
          desiredState({ volumes: [desiredVolume({ storage: s3Storage() })] }),
        );
        expect((yield* allocator.allocate(APP_ID)).slot).toBe(FIRST_SLOT);
        stage.nodes.clear();
        const unavailable = yield* Effect.either(allocator.allocate(APP_ID));
        expect(Either.isLeft(unavailable) && unavailable.left._tag).toBe(
          'NbdAttachmentUnavailable',
        );
        expect((yield* allocator.allocate(OTHER_APP)).slot).toBe(FIRST_SLOT + 1);
      }),
    );
  });

  test('wraps past unavailable slots without changing the shared allocation policy', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host([FIRST_SLOT]);
        yield* (yield* FileSystem.FileSystem).writeFileString(stage.slotCursorFile, `${LAST_SLOT}`);
        const allocator = yield* stage.open;
        expect((yield* allocator.allocate(OTHER_APP)).slot).toBe(LAST_SLOT);
        expect((yield* allocator.allocateWithNbdDevice(APP_ID)).slot).toBe(FIRST_SLOT);
      }),
    );
  });

  test('sysfs entries without a block node cannot be allocated', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host([FIRST_SLOT, LAST_SLOT]);
        stage.nodes.delete('/dev/nbd0');
        stage.regular.add(`/dev/nbd${LAST_SLOT}`);
        const allocator = yield* stage.open;
        const result = yield* Effect.either(allocator.allocateWithNbdDevice(APP_ID));
        expect(Either.isLeft(result) && result.left._tag).toBe('NbdAttachmentUnavailable');
        expect(yield* allocator.slots).toEqual([]);
      }),
    );
  });

  test('a block node without its kernel device and the checkpoint reader are not app slots', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host([FIRST_SLOT, SLOT_COUNT]);
        stage.kernel.delete('nbd0');
        const allocator = yield* stage.open;
        const result = yield* Effect.either(allocator.allocateWithNbdDevice(APP_ID));
        expect(Either.isLeft(result) && result.left._tag).toBe('NbdAttachmentUnavailable');
        expect(yield* allocator.slots).toEqual([]);
      }),
    );
  });

  test('exhausting existing devices neither takes an occupied slot nor advances the cursor', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host([FIRST_SLOT]);
        const allocator = yield* stage.open;
        yield* allocator.allocateWithNbdDevice(APP_ID);
        const result = yield* Effect.either(allocator.allocateWithNbdDevice(OTHER_APP));
        expect(Either.isLeft(result) && result.left._tag).toBe('NbdAttachmentUnavailable');
        expect(Option.isNone(yield* allocator.lookup(OTHER_APP))).toBe(true);
        expect((yield* allocator.allocate(OTHER_APP)).slot).toBe(FIRST_SLOT + 1);
      }),
    );
  });

  test('a missing assigned device preserves the assignment across an agent restart', async () => {
    await run(
      Effect.gen(function* () {
        const stage = yield* host([FIRST_SLOT]);
        const allocator = yield* stage.open;
        const original = yield* allocator.allocateWithNbdDevice(APP_ID);
        yield* allocator.persist;
        stage.nodes.delete(original.nbdDevicePath);
        const restarted = yield* stage.open;
        const result = yield* Effect.either(restarted.allocateWithNbdDevice(APP_ID));
        expect(Either.isLeft(result) && result.left._tag).toBe('NbdAttachmentUnavailable');
        expect(yield* restarted.lookup(APP_ID)).toEqual(Option.some(original));
        stage.nodes.add(original.nbdDevicePath);
        expect(yield* restarted.allocateWithNbdDevice(APP_ID)).toEqual(original);
      }),
    );
  });

  test.each(['/sys/block', '/dev/nbd0'])(
    'unreadable device metadata at %s fails closed while shared allocation still works',
    async (path) => {
      await run(
        Effect.gen(function* () {
          const stage = yield* host([FIRST_SLOT]);
          stage.denied.add(path);
          const allocator = yield* stage.open;
          const result = yield* Effect.either(allocator.allocateWithNbdDevice(APP_ID));
          expect(Either.isLeft(result) && result.left._tag).toBe('NbdAttachmentUnavailable');
          expect(yield* allocator.allocate(APP_ID)).toEqual(
            describeSlot({ slot: FIRST_SLOT, appId: APP_ID }),
          );
        }),
      );
    },
  );
});
