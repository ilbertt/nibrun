import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { FileSystem } from '@effect/platform';
import { Effect, Layer, Option } from 'effect';
import { NBD_DIRECTORY } from '#lib/volumes/device-file.ts';
import { flush } from '#lib/volumes/zerofs.ts';
import { AppVolumeFiles } from '#services/app-volume-files.service.ts';
import { CommandRunner } from '#services/command-runner.service.ts';
import { VOLUME_ID, VOLUME_SIZE_BYTES } from '#tests/support/fixtures.ts';
import { platform, provided } from '#tests/support/run.ts';
import { s3Backend } from '#tests/support/s3-backend.ts';
import { configuredZerofs } from '#tests/support/zerofs.ts';

const TEST_TIMEOUT_MS = 300_000;
const PAYLOAD = 'customer data survives a ZeroFS restart without its local cache';
const run = provided(
  Layer.mergeAll(CommandRunner.Default, AppVolumeFiles.Default).pipe(Layer.provideMerge(platform)),
);

test.skipIf(process.platform !== 'linux' || process.env.NIBRUN_TEST_ZEROFS !== '1')(
  'configured ZeroFS restores its live volume from S3 after a restart with no local cache',
  async () => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const files = yield* AppVolumeFiles;
        const backend = yield* s3Backend();
        const host = yield* configuredZerofs(backend);
        const input = { mountPath: host.paths.mountPath, volumeId: VOLUME_ID };
        const image = join(host.paths.mountPath, NBD_DIRECTORY, VOLUME_ID);
        yield* host.run(
          Effect.gen(function* () {
            expect(Option.isNone(yield* files.size(input))).toBe(true);
            expect(yield* files.ensure({ ...input, sizeBytes: VOLUME_SIZE_BYTES })).toBe(
              VOLUME_SIZE_BYTES,
            );
            yield* Effect.scoped(
              Effect.gen(function* () {
                const file = yield* fs.open(image, { flag: 'r+' });
                yield* file.writeAll(new TextEncoder().encode(PAYLOAD));
              }),
            );
            yield* flush(host.admin);
            expect(yield* backend.list).toContain('<Key>');
          }),
        );
        yield* host.clearCache;
        yield* host.run(
          Effect.gen(function* () {
            expect(Option.getOrThrow(yield* files.size(input))).toBe(VOLUME_SIZE_BYTES);
            expect((yield* fs.readFileString(image)).startsWith(PAYLOAD)).toBe(true);
          }),
        );
      }).pipe(Effect.timeout('4 minutes')),
    );
  },
  TEST_TIMEOUT_MS,
);
