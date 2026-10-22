import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { FileSystem } from '@effect/platform';
import { Effect, Layer, Option } from 'effect';
import { isAttached } from '#lib/volumes/nbd.ts';
import { flush } from '#lib/volumes/zerofs.ts';
import { AppVolumeFiles } from '#services/app-volume-files.service.ts';
import { AppVolumeNbd } from '#services/app-volume-nbd.service.ts';
import { CommandRunner, stdoutOf } from '#services/command-runner.service.ts';
import { agentConfig } from '#tests/support/config.ts';
import { VOLUME_ID, VOLUME_SIZE_BYTES } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';
import { s3Backend } from '#tests/support/s3-backend.ts';
import { configuredZerofs } from '#tests/support/zerofs.ts';

const TEST_TIMEOUT_MS = 300_000;
const PAYLOAD = 'customer data survives a ZeroFS restart without its local cache';
const NBD_DEVICE = '/dev/nbd0';
const run = provided(
  Layer.mergeAll(
    CommandRunner.Default,
    AppVolumeFiles.Default,
    AppVolumeNbd.DefaultWithoutDependencies.pipe(Layer.provide(agentConfig())),
  ).pipe(Layer.provideMerge(platform)),
);

function attachedVolume<A, E, R>({
  target,
  effect,
}: {
  target: Parameters<AppVolumeNbd['reattach']>[0];
  effect: Effect.Effect<A, E, R>;
}) {
  return Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const nbd = yield* AppVolumeNbd;
      if (
        (yield* fs.stat(target.devicePath)).type !== 'BlockDevice' ||
        (yield* isAttached(target.devicePath))
      ) {
        return yield* Effect.fail(
          new Error('The ZeroFS fixture requires an unused NBD block device.'),
        );
      }
      yield* Effect.addFinalizer(() => nbd.detach(target).pipe(Effect.orDie));
      yield* nbd.reattach(target);
      return yield* effect;
    }),
  );
}

test.skipIf(process.platform !== 'linux' || process.env.NIBRUN_TEST_ZEROFS !== '1')(
  'configured ZeroFS restores NBD writes from S3 after a restart with no local cache',
  async () => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const files = yield* AppVolumeFiles;
        const backend = yield* s3Backend();
        const host = yield* configuredZerofs(backend);
        const input = { mountPath: host.paths.mountPath, volumeId: VOLUME_ID };
        const directory = yield* temporaryDirectory;
        const original = join(directory, 'original');
        const recovered = join(directory, 'recovered');
        const payload = new Uint8Array(VOLUME_SIZE_BYTES);
        payload.set(new TextEncoder().encode(PAYLOAD));
        yield* fs.writeFile(original, payload);
        const target = {
          socketPath: host.paths.sockets.nbd,
          devicePath: NBD_DEVICE,
          volumeId: VOLUME_ID,
        };
        yield* host.run(
          Effect.gen(function* () {
            expect(Option.isNone(yield* files.size(input))).toBe(true);
            expect(yield* files.ensure({ ...input, sizeBytes: VOLUME_SIZE_BYTES })).toBe(
              VOLUME_SIZE_BYTES,
            );
            yield* attachedVolume({
              target,
              effect: Effect.gen(function* () {
                yield* stdoutOf({
                  command: [
                    'dd',
                    `if=${original}`,
                    `of=${target.devicePath}`,
                    `bs=${VOLUME_SIZE_BYTES}`,
                    'count=1',
                    'oflag=direct',
                    'conv=fsync',
                    'status=none',
                  ],
                });
                yield* flush(host.admin);
                expect(yield* backend.list).toContain('<Key>');
              }),
            });
          }),
        );
        yield* host.clearCache;
        yield* host.run(
          Effect.gen(function* () {
            expect(Option.getOrThrow(yield* files.size(input))).toBe(VOLUME_SIZE_BYTES);
            yield* attachedVolume({
              target,
              effect: Effect.gen(function* () {
                yield* stdoutOf({
                  command: [
                    'dd',
                    `if=${target.devicePath}`,
                    `of=${recovered}`,
                    `bs=${VOLUME_SIZE_BYTES}`,
                    'count=1',
                    'iflag=direct',
                    'status=none',
                  ],
                });
                expect(Buffer.from(yield* fs.readFile(recovered))).toEqual(Buffer.from(payload));
              }),
            });
          }),
        );
      }).pipe(Effect.timeout('4 minutes')),
    );
  },
  TEST_TIMEOUT_MS,
);
