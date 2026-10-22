import { dirname, join } from 'node:path';
import { Command, FileSystem } from '@effect/platform';
import { type AppId, AppIdSchema, type S3VolumeStorage } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect, Schedule } from 'effect';
import { APP_ZEROFS_CACHE } from '#lib/volumes/app-zerofs-cache.ts';
import { appZerofsPaths, stageAppZerofsConfig } from '#lib/volumes/app-zerofs-config.ts';
import type { ZerofsAdmin } from '#lib/volumes/zerofs.ts';
import { stdoutOf } from '#services/command-runner.service.ts';
import { agentConfig } from '#tests/support/config.ts';
import { temporaryDirectory } from '#tests/support/run.ts';

function zerofsBinary() {
  return Effect.gen(function* () {
    const override = process.env.NIBRUN_TEST_ZEROFS_BINARY;
    if (override) {
      return override;
    }
    const directory = yield* temporaryDirectory;
    const { zerofs } = yield* Effect.promise(() =>
      Bun.file(new URL('../../../../infra/app-host/versions.json', import.meta.url)).json(),
    );
    const archive = join(directory, 'zerofs.tar.gz');
    yield* stdoutOf({
      command: [
        'curl',
        '--fail',
        '--location',
        '--silent',
        '--show-error',
        '--output',
        archive,
        zerofs.url,
      ],
      timeout: '5 minutes',
    });
    const bytes = yield* Effect.promise(() => Bun.file(archive).arrayBuffer());
    if (new Bun.CryptoHasher('sha256').update(bytes).digest('hex') !== zerofs.sha256) {
      return yield* Effect.fail(new Error('The pinned ZeroFS archive checksum did not match.'));
    }
    yield* stdoutOf({
      command: [
        'tar',
        '--extract',
        '--gzip',
        '--file',
        archive,
        '--directory',
        directory,
        zerofs.member,
      ],
    });
    return join(directory, zerofs.member);
  });
}

function writer<A, E, R>({
  binary,
  paths,
  certificate,
  effect,
}: {
  binary: string;
  paths: ReturnType<typeof appZerofsPaths>;
  certificate: string;
  effect: Effect.Effect<A, E, R>;
}) {
  return Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const poll = Schedule.spaced('100 millis').pipe(Schedule.upTo('30 seconds'));
      const runtimeDirectory = dirname(paths.sockets.nbd);
      yield* fs.remove(runtimeDirectory, { recursive: true, force: true });
      yield* fs.makeDirectory(runtimeDirectory, { recursive: true });
      yield* Command.start(
        Command.make(binary, 'run', '--config', paths.configFile).pipe(
          Command.env({ SSL_CERT_FILE: certificate, NO_PROXY: '*', no_proxy: '*' }),
          Command.stdout('inherit'),
          Command.stderr('inherit'),
        ),
      );
      yield* fs.exists(paths.sockets.rpc).pipe(
        Effect.filterOrFail(
          (ready) => ready,
          () => new Error('ZeroFS did not open its RPC socket.'),
        ),
        Effect.retry(poll),
      );
      yield* Command.start(
        Command.make(
          binary,
          'mount',
          '--writeback',
          'false',
          `unix:${paths.sockets.ninep}`,
          paths.mountPath,
        ).pipe(Command.stdout('inherit'), Command.stderr('inherit')),
      );
      yield* Effect.addFinalizer(() =>
        stdoutOf({ command: ['fusermount3', '-u', paths.mountPath] }).pipe(Effect.ignore),
      );
      yield* stdoutOf({ command: ['mountpoint', '--quiet', '--', paths.mountPath] }).pipe(
        Effect.retry(poll),
      );
      return yield* effect;
    }),
  );
}

export function configuredZerofs({
  storage,
  certificate,
}: {
  storage: S3VolumeStorage;
  certificate: string;
}) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const binary = yield* zerofsBinary();
    const appId: AppId = Value.Parse(AppIdSchema, `integration-${process.pid}`);
    const stateDir = yield* temporaryDirectory;
    const paths = appZerofsPaths({ appId, stateDir });
    const owned = [paths.mountPath, paths.cacheDirectory, dirname(paths.sockets.nbd)];
    for (const path of owned) {
      if (yield* fs.exists(path)) {
        return yield* Effect.fail(
          new Error('ZeroFS fixture refuses to replace existing app files.'),
        );
      }
    }
    yield* Effect.addFinalizer(() =>
      Effect.forEach(owned, (path) =>
        fs.remove(path, { recursive: true, force: true }).pipe(Effect.ignore),
      ),
    );
    for (const path of owned) {
      yield* fs.makeDirectory(path, { recursive: true });
    }
    yield* stageAppZerofsConfig({ appId, storage, cache: APP_ZEROFS_CACHE }).pipe(
      Effect.provide(agentConfig({ stateDir })),
    );
    return {
      paths,
      admin: { binary, configFile: paths.configFile } satisfies ZerofsAdmin,
      run: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        writer({ binary, paths, certificate, effect }),
      clearCache: fs
        .remove(paths.cacheDirectory, { recursive: true })
        .pipe(Effect.andThen(fs.makeDirectory(paths.cacheDirectory))),
    };
  });
}
