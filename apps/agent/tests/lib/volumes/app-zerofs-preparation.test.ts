import { describe, expect, test } from 'bun:test';
import { FileSystem } from '@effect/platform';
import { SystemError } from '@effect/platform/Error';
import { Effect, Either, Layer } from 'effect';
import { appZerofsPaths, stageAppZerofsConfig } from '#lib/volumes/app-zerofs-config.ts';
import { prepareAppZerofs } from '#lib/volumes/app-zerofs-preparation.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';
import { agentConfig } from '#tests/support/config.ts';
import { APP_ID } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';
import { s3Storage } from '#tests/support/s3-storage.ts';

const run = provided(platform);
const CACHE = { diskSizeGb: 4, memorySizeGb: 0.25 };
const PRIVATE_FILE_MODE = 0o600;

function preparation() {
  return prepareAppZerofs({ appId: APP_ID, storage: s3Storage(), cache: CACHE });
}

describe('preparing an app ZeroFS instance without starting it', () => {
  test('stages config before granting the service user access to its private cache', async () => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const stateDir = yield* temporaryDirectory;
        const paths = appZerofsPaths({ appId: APP_ID, stateDir });
        const commands = recordingCommands((request) =>
          Effect.gen(function* () {
            const configExists = yield* fs.exists(paths.configFile);
            expect(configExists).toBe(request.command[0] === 'install');
            return yield* succeeding();
          }),
        );
        const prepared = yield* preparation().pipe(
          Effect.provide(Layer.merge(agentConfig({ stateDir }), commands.layer)),
        );
        expect(prepared).toEqual(paths);
        expect(commands.commands.map(({ command }) => command)).toEqual([
          ['mountpoint', '--quiet', '--', '/data'],
          [
            'install',
            '--directory',
            '--mode=0700',
            '--owner=zerofs',
            '--group=zerofs',
            '--',
            paths.cacheDirectory,
          ],
        ]);
      }),
    );
  });

  test('an unmounted data disk prevents both config staging and cache creation', async () => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const stateDir = yield* temporaryDirectory;
        const commands = recordingCommands(() =>
          succeeding({ code: 1, stderr: 'customer-secret-key' }),
        );
        const result = yield* Effect.either(
          preparation().pipe(
            Effect.provide(Layer.merge(agentConfig({ stateDir }), commands.layer)),
          ),
        );
        expect(Either.isLeft(result) && result.left._tag).toBe('AppZerofsCacheUnavailable');
        expect(JSON.stringify(result)).not.toContain('customer-secret-key');
        expect(commands.executables()).toEqual(['mountpoint']);
        expect(yield* fs.readDirectory(stateDir)).toEqual([]);
      }),
    );
  });

  test('a conflicting config prevents changes to the existing cache directory', async () => {
    await run(
      Effect.gen(function* () {
        const stateDir = yield* temporaryDirectory;
        yield* stageAppZerofsConfig({
          appId: APP_ID,
          storage: s3Storage({ prefix: 'another-filesystem' }),
          cache: CACHE,
        }).pipe(Effect.provide(agentConfig({ stateDir })));
        const commands = recordingCommands();
        const result = yield* Effect.either(
          preparation().pipe(
            Effect.provide(Layer.merge(agentConfig({ stateDir }), commands.layer)),
          ),
        );
        expect(Either.isLeft(result) && result.left._tag).toBe('AppZerofsConfigConflict');
        expect(commands.executables()).toEqual(['mountpoint']);
      }),
    );
  });

  test('a failed cache preparation retains the private config and can be retried', async () => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const stateDir = yield* temporaryDirectory;
        const failing = recordingCommands((request) =>
          succeeding({
            code: request.command[0] === 'install' ? 1 : 0,
            stderr: 'customer-secret-key',
          }),
        );
        const failed = yield* Effect.either(
          preparation().pipe(Effect.provide(Layer.merge(agentConfig({ stateDir }), failing.layer))),
        );
        expect(Either.isLeft(failed) && failed.left._tag).toBe('AppZerofsCacheUnavailable');
        expect(JSON.stringify(failed)).not.toContain('customer-secret-key');
        const paths = appZerofsPaths({ appId: APP_ID, stateDir });
        const original = yield* fs.stat(paths.configFile);
        const retry = recordingCommands();
        yield* preparation().pipe(
          Effect.provide(Layer.merge(agentConfig({ stateDir }), retry.layer)),
        );
        const retained = yield* fs.stat(paths.configFile);
        expect(retained.ino).toEqual(original.ino);
        expect(retained.mtime).toEqual(original.mtime);
        expect(retained.mode & 0o777).toBe(PRIVATE_FILE_MODE);
        expect(retry.executables()).toEqual(['mountpoint', 'install']);
      }),
    );
  });

  test('a command execution failure is reported without subprocess details', async () => {
    await run(
      Effect.gen(function* () {
        const stateDir = yield* temporaryDirectory;
        const commands = recordingCommands(() =>
          Effect.fail(
            new SystemError({
              module: 'Command',
              method: 'start',
              reason: 'NotFound',
              description: 'customer-secret-key',
            }),
          ),
        );
        const result = yield* Effect.either(
          preparation().pipe(
            Effect.provide(Layer.merge(agentConfig({ stateDir }), commands.layer)),
          ),
        );
        expect(Either.isLeft(result) && result.left._tag).toBe('AppZerofsCacheUnavailable');
        expect(JSON.stringify(result)).not.toContain('customer-secret-key');
      }),
    );
  });
});
