import { describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { FileSystem } from '@effect/platform';
import { Effect, Either, Layer, Option } from 'effect';
import { NBD_DIRECTORY } from '#lib/volumes/device-file.ts';
import { AppVolumeFiles } from '#services/app-volume-files.service.ts';
import { VOLUME_ID, VOLUME_SIZE_BYTES } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const run = provided(platform);

function host() {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* temporaryDirectory;
    const mountPath = join(directory, 'mount');
    yield* fs.makeDirectory(mountPath);
    const mounted = Layer.succeed(FileSystem.FileSystem, {
      ...fs,
      stat: (path) =>
        fs
          .stat(path)
          .pipe(
            Effect.map((info) =>
              path === dirname(mountPath) ? { ...info, dev: info.dev + 1 } : info,
            ),
          ),
    });
    const files = yield* AppVolumeFiles.pipe(
      Effect.provide(AppVolumeFiles.Default.pipe(Layer.provide(mounted))),
    );
    return { fs, directory, mountPath, files, input: { mountPath, volumeId: VOLUME_ID } };
  });
}

describe('private volume images stay inside the opened filesystem', () => {
  test.skipIf(process.platform !== 'linux')(
    'create, inspect, grow and remove use the same private directory',
    async () => {
      await run(
        Effect.gen(function* () {
          const stage = yield* host();
          expect(Option.isNone(yield* stage.files.size(stage.input))).toBe(true);
          yield* stage.files.ensure({ ...stage.input, sizeBytes: VOLUME_SIZE_BYTES });
          const image = join(stage.mountPath, NBD_DIRECTORY, VOLUME_ID);
          yield* stage.fs.writeFileString(image, 'tenant data');
          yield* stage.files.ensure({ ...stage.input, sizeBytes: VOLUME_SIZE_BYTES });
          expect((yield* stage.fs.readFileString(image)).startsWith('tenant data')).toBe(true);
          expect(Option.getOrThrow(yield* stage.files.size(stage.input))).toBe(VOLUME_SIZE_BYTES);
          const refused = yield* Effect.either(
            stage.files.ensure({ ...stage.input, sizeBytes: VOLUME_SIZE_BYTES / 2 }),
          );
          expect(Either.isLeft(refused) && refused.left._tag).toBe('VolumeShrinkRefused');
          yield* stage.files.remove(stage.input);
          expect(yield* stage.fs.exists(image)).toBe(false);
        }),
      );
    },
  );

  test.skipIf(process.platform !== 'linux')(
    'a symlink image cannot resize or expose an outside file',
    async () => {
      await run(
        Effect.gen(function* () {
          const stage = yield* host();
          const victim = join(stage.directory, 'outside');
          yield* stage.fs.writeFileString(victim, 'outside data');
          yield* stage.fs.makeDirectory(join(stage.mountPath, NBD_DIRECTORY));
          yield* stage.fs.symlink(victim, join(stage.mountPath, NBD_DIRECTORY, VOLUME_ID));
          expect(
            Either.isLeft(
              yield* Effect.either(
                stage.files.ensure({ ...stage.input, sizeBytes: VOLUME_SIZE_BYTES }),
              ),
            ),
          ).toBe(true);
          expect(Either.isLeft(yield* Effect.either(stage.files.size(stage.input)))).toBe(true);
          yield* stage.files.remove(stage.input);
          expect(yield* stage.fs.readFileString(victim)).toBe('outside data');
        }),
      );
    },
  );

  test.skipIf(process.platform !== 'linux')(
    'a symlink export directory cannot create or delete files outside the mount',
    async () => {
      await run(
        Effect.gen(function* () {
          const stage = yield* host();
          const outside = join(stage.directory, 'outside-directory');
          yield* stage.fs.makeDirectory(outside);
          const victim = join(outside, VOLUME_ID);
          yield* stage.fs.writeFileString(victim, 'outside data');
          yield* stage.fs.symlink(outside, join(stage.mountPath, NBD_DIRECTORY));
          expect(
            Either.isLeft(
              yield* Effect.either(
                stage.files.ensure({ ...stage.input, sizeBytes: VOLUME_SIZE_BYTES }),
              ),
            ),
          ).toBe(true);
          expect(Either.isLeft(yield* Effect.either(stage.files.remove(stage.input)))).toBe(true);
          expect(yield* stage.fs.readFileString(victim)).toBe('outside data');
        }),
      );
    },
  );

  test('an unmounted directory is never treated as customer storage', async () => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const mountPath = yield* temporaryDirectory;
        const result = yield* AppVolumeFiles.pipe(
          Effect.flatMap((files) =>
            files.ensure({ mountPath, volumeId: VOLUME_ID, sizeBytes: VOLUME_SIZE_BYTES }),
          ),
          Effect.either,
          Effect.provide(AppVolumeFiles.Default),
        );
        expect(Either.isLeft(result) && result.left._tag).toBe('AppVolumeFileUnavailable');
        expect(yield* fs.exists(join(mountPath, NBD_DIRECTORY))).toBe(false);
      }),
    );
  });
});
