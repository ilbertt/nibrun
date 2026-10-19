import { describe, expect, test } from 'bun:test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileSystem } from '@effect/platform';
import { SystemError } from '@effect/platform/Error';
import { AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Deferred, Effect, Either, Fiber, Layer } from 'effect';
import { appZerofsPaths, stageAppZerofsConfig } from '#lib/volumes/app-zerofs-config.ts';
import { agentConfig } from '#tests/support/config.ts';
import { APP_ID } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';
import { s3Storage } from '#tests/support/s3-storage.ts';

const run = provided(platform);
const CACHE = { diskSizeGb: 4, memorySizeGb: 0.25 };
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PUBLIC_FILE_MODE = 0o644;
const PUBLIC_DIRECTORY_MODE = 0o755;

function stagingAt(stateDir: string) {
  return stageAppZerofsConfig({ appId: APP_ID, storage: s3Storage(), cache: CACHE }).pipe(
    Effect.provide(agentConfig({ stateDir })),
  );
}

describe('staging per-app ZeroFS credentials', () => {
  test('uses the paths expected by the installed systemd template', async () => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const template = yield* fs.readFileString(
          fileURLToPath(
            new URL(
              '../../../../../infra/app-host/systemd/nibrun-app-zerofs@.service',
              import.meta.url,
            ),
          ),
        );
        const paths = appZerofsPaths({ appId: APP_ID, stateDir: '/var/lib/nibrun' });
        const instance = template.replaceAll('%i', APP_ID);
        expect(instance).toContain(`LoadCredential=zerofs.toml:${paths.configFile}`);
        expect(instance).toContain(`ReadWritePaths=${paths.cacheDirectory}`);
        expect(instance).toContain(
          `RuntimeDirectory=${dirname(paths.sockets.nbd).slice('/run/'.length)}`,
        );
        expect(Object.values(paths.sockets)).toEqual([
          `/run/zerofs-apps/${APP_ID}/nbd.sock`,
          `/run/zerofs-apps/${APP_ID}/9p.sock`,
          `/run/zerofs-apps/${APP_ID}/rpc.sock`,
        ]);
      }),
    );
  });

  test('stages a complete config with private permissions and no temporary credentials', async () => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const stateDir = yield* temporaryDirectory;
        const paths = yield* stagingAt(stateDir);
        const contents = Bun.TOML.parse(yield* fs.readFileString(paths.configFile));
        expect(contents).toHaveProperty('storage.url', 's3://customer-data/apps/app-1');
        expect(contents).toHaveProperty('aws.secret_access_key', 'customer-secret-key');
        expect(contents).toHaveProperty('cache.dir', paths.cacheDirectory);
        expect(contents).toHaveProperty('servers.nbd.unix_socket', paths.sockets.nbd);
        expect((yield* fs.stat(paths.configFile)).mode & 0o777).toBe(PRIVATE_FILE_MODE);
        expect((yield* fs.stat(dirname(paths.configFile))).mode & 0o777).toBe(
          PRIVATE_DIRECTORY_MODE,
        );
        expect(yield* fs.readDirectory(dirname(paths.configFile))).toEqual(['config.toml']);
        expect(yield* fs.readDirectory(stateDir)).toEqual(['zerofs']);
      }),
    );
  });

  test('retries preserve the existing file and restore private permissions', async () => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const stateDir = yield* temporaryDirectory;
        const paths = yield* stagingAt(stateDir);
        const original = yield* fs.stat(paths.configFile);
        yield* fs.chmod(paths.configFile, PUBLIC_FILE_MODE);
        yield* fs.chmod(dirname(paths.configFile), PUBLIC_DIRECTORY_MODE);
        yield* stagingAt(stateDir);
        const retried = yield* fs.stat(paths.configFile);
        expect(retried.ino).toEqual(original.ino);
        expect(retried.mtime).toEqual(original.mtime);
        expect(retried.mode & 0o777).toBe(PRIVATE_FILE_MODE);
        expect((yield* fs.stat(dirname(paths.configFile))).mode & 0o777).toBe(
          PRIVATE_DIRECTORY_MODE,
        );
      }),
    );
  });

  test('refuses configuration changes without replacing or exposing either config', async () => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const stateDir = yield* temporaryDirectory;
        const paths = yield* stagingAt(stateDir);
        const original = yield* fs.readFileString(paths.configFile);
        const result = yield* Effect.either(
          stageAppZerofsConfig({
            appId: APP_ID,
            storage: s3Storage({ bucket: 'different-bucket', encryptionPassword: 'new-password' }),
            cache: CACHE,
          }).pipe(Effect.provide(agentConfig({ stateDir }))),
        );
        expect(Either.isLeft(result) && result.left._tag).toBe('AppZerofsConfigConflict');
        expect(JSON.stringify(result)).not.toContain('customer-secret-key');
        expect(JSON.stringify(result)).not.toContain('new-password');
        expect(JSON.stringify(result)).not.toContain('different-bucket');
        expect(yield* fs.readFileString(paths.configFile)).toBe(original);
        expect(yield* fs.readDirectory(dirname(paths.configFile))).toEqual(['config.toml']);
      }),
    );
  });

  test('concurrent identical requests publish one config and clean all temporary files', async () => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const stateDir = yield* temporaryDirectory;
        const paths = yield* Effect.all([stagingAt(stateDir), stagingAt(stateDir)], {
          concurrency: 'unbounded',
        });
        expect(paths[0]).toEqual(paths[1]);
        expect(yield* fs.readDirectory(dirname(paths[0].configFile))).toEqual(['config.toml']);
      }),
    );
  });

  test('concurrent different configs produce one winner and one conflict', async () => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const stateDir = yield* temporaryDirectory;
        const competing = stageAppZerofsConfig({
          appId: APP_ID,
          storage: s3Storage({ prefix: 'another-filesystem' }),
          cache: CACHE,
        }).pipe(Effect.provide(agentConfig({ stateDir })));
        const results = yield* Effect.all(
          [Effect.either(stagingAt(stateDir)), Effect.either(competing)],
          { concurrency: 'unbounded' },
        );
        expect(results.filter(Either.isRight)).toHaveLength(1);
        expect(results.filter(Either.isLeft).map((result) => result.left._tag)).toEqual([
          'AppZerofsConfigConflict',
        ]);
        const paths = appZerofsPaths({ appId: APP_ID, stateDir });
        const contents = Bun.TOML.parse(yield* fs.readFileString(paths.configFile));
        expect(contents).toHaveProperty(
          'storage.url',
          Either.isRight(results[0])
            ? 's3://customer-data/apps/app-1'
            : 's3://customer-data/another-filesystem',
        );
        expect(yield* fs.readDirectory(dirname(paths.configFile))).toEqual(['config.toml']);
      }),
    );
  });

  test('interruption before publication removes temporary credentials', async () => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const stateDir = yield* temporaryDirectory;
        const publishing = yield* Deferred.make<void>();
        const pausedFs = Layer.succeed(FileSystem.FileSystem, {
          ...fs,
          link: () => Deferred.succeed(publishing, undefined).pipe(Effect.andThen(Effect.never)),
        });
        const staging = yield* Effect.forkScoped(
          stagingAt(stateDir).pipe(Effect.provide(pausedFs)),
        );
        yield* Deferred.await(publishing);
        yield* Fiber.interrupt(staging);
        const paths = appZerofsPaths({ appId: APP_ID, stateDir });
        expect(yield* fs.exists(paths.configFile)).toBe(false);
        expect(yield* fs.readDirectory(dirname(paths.configFile))).toEqual([]);
      }),
    );
  });

  test('different apps keep separate configs and sockets', async () => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const stateDir = yield* temporaryDirectory;
        const first = yield* stagingAt(stateDir);
        const second = yield* stageAppZerofsConfig({
          appId: Value.Parse(AppIdSchema, 'app-2'),
          storage: s3Storage({ prefix: 'apps/app-2' }),
          cache: CACHE,
        }).pipe(Effect.provide(agentConfig({ stateDir })));
        expect(first.configFile).not.toBe(second.configFile);
        expect(first.cacheDirectory).not.toBe(second.cacheDirectory);
        expect(first.sockets.nbd).not.toBe(second.sockets.nbd);
        expect(Bun.TOML.parse(yield* fs.readFileString(first.configFile))).toHaveProperty(
          'storage.url',
          's3://customer-data/apps/app-1',
        );
        expect(Bun.TOML.parse(yield* fs.readFileString(second.configFile))).toHaveProperty(
          'storage.url',
          's3://customer-data/apps/app-2',
        );
      }),
    );
  });

  test('a write failure publishes nothing, removes temporary credentials and hides its cause', async () => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const stateDir = yield* temporaryDirectory;
        const paths = appZerofsPaths({ appId: APP_ID, stateDir });
        const failingFs = Layer.succeed(FileSystem.FileSystem, {
          ...fs,
          writeFileString: (path) =>
            fs.writeFileString(path, 'partial-customer-secret-key', { mode: 0o600 }).pipe(
              Effect.andThen(
                Effect.fail(
                  new SystemError({
                    module: 'FileSystem',
                    method: 'writeFileString',
                    reason: 'WriteZero',
                    description: 'customer-secret-key',
                  }),
                ),
              ),
            ),
        });
        const result = yield* Effect.either(stagingAt(stateDir).pipe(Effect.provide(failingFs)));
        expect(Either.isLeft(result) && result.left._tag).toBe('AppZerofsConfigUnavailable');
        expect(JSON.stringify(result)).not.toContain('customer-secret-key');
        expect(yield* fs.exists(paths.configFile)).toBe(false);
        expect(yield* fs.readDirectory(dirname(paths.configFile))).toEqual([]);
      }),
    );
  });
});
