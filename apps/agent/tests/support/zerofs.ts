import { dirname, join } from 'node:path';
import { Command, FileSystem } from '@effect/platform';
import { type AppId, AppIdSchema, type CheckpointId, type S3VolumeStorage } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect, Schedule } from 'effect';
import { APP_ZEROFS_CACHE } from '#lib/volumes/app-zerofs-cache.ts';
import { appZerofsPaths, stageAppZerofsConfig } from '#lib/volumes/app-zerofs-config.ts';
import { appZerofsFilesystem } from '#lib/volumes/app-zerofs-filesystem.ts';
import { renderZerofsConfig } from '#lib/volumes/zerofs-config.ts';
import { stdoutOf } from '#services/command-runner.service.ts';
import { agentConfig } from '#tests/support/config.ts';
import { temporaryDirectory } from '#tests/support/run.ts';

const EXECUTABLE_MODE = 0o755;
const CONFIG_FILE_MODE = 0o600;

type MountedZerofsPaths = Pick<ReturnType<typeof appZerofsPaths>, 'configFile' | 'mountPath'> & {
  sockets: Parameters<typeof renderZerofsConfig>[0]['sockets'] & { ninep: string };
};

export function zerofsBinary() {
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
    const binary = join(directory, zerofs.member);
    yield* (yield* FileSystem.FileSystem).chmod(binary, EXECUTABLE_MODE);
    return binary;
  });
}

function mountedZerofs<A, E, R>({
  binary,
  paths,
  certificate,
  checkpointId,
  effect,
}: {
  binary: string;
  paths: MountedZerofsPaths;
  certificate: string;
  checkpointId: CheckpointId | undefined;
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
        Command.make(
          binary,
          'run',
          '--config',
          paths.configFile,
          ...(checkpointId === undefined ? [] : ['--checkpoint', checkpointId]),
        ).pipe(
          Command.env({ SSL_CERT_FILE: certificate, NO_PROXY: '*', no_proxy: '*' }),
          Command.stdout('inherit'),
          Command.stderr('inherit'),
        ),
      );
      yield* Effect.all(
        Object.values(paths.sockets)
          .filter((socket) => socket !== undefined)
          .map((socket) => fs.exists(socket)),
      ).pipe(
        Effect.filterOrFail(
          (listeners) => listeners.every(Boolean),
          () => new Error('ZeroFS did not open its listener sockets.'),
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
    const appId: AppId = Value.Parse(AppIdSchema, `integration-${crypto.randomUUID()}`);
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
    const config = agentConfig({ stateDir, zerofsBinary: binary });
    yield* stageAppZerofsConfig({ appId, storage, cache: APP_ZEROFS_CACHE }).pipe(
      Effect.provide(config),
    );
    const filesystem = yield* appZerofsFilesystem({ appId, storagePrefix: storage.prefix }).pipe(
      Effect.provide(config),
    );
    function readCheckpoint<A, E, R>({
      checkpointId,
      use,
    }: {
      checkpointId: CheckpointId;
      use: (mountPath: string) => Effect.Effect<A, E, R>;
    }) {
      return Effect.scoped(
        Effect.gen(function* () {
          const directory = yield* temporaryDirectory;
          const readerPaths = {
            configFile: join(directory, 'checkpoint.toml'),
            mountPath: join(directory, 'mount'),
            sockets: {
              nbd: join(directory, 'run', 'nbd.sock'),
              ninep: join(directory, 'run', '9p.sock'),
              rpc: undefined,
            },
          } satisfies MountedZerofsPaths;
          yield* fs.makeDirectory(readerPaths.mountPath);
          yield* fs.writeFileString(
            readerPaths.configFile,
            renderZerofsConfig({
              storage,
              cache: { ...APP_ZEROFS_CACHE, directory: join(directory, 'cache') },
              sockets: readerPaths.sockets,
              readOnly: true,
            }),
            { mode: CONFIG_FILE_MODE, flag: 'wx' },
          );
          return yield* mountedZerofs({
            binary,
            paths: readerPaths,
            certificate,
            checkpointId,
            effect: use(readerPaths.mountPath),
          });
        }),
      );
    }
    return {
      appId,
      paths,
      filesystem,
      admin: filesystem.admin,
      run: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        mountedZerofs({ binary, paths, certificate, checkpointId: undefined, effect }),
      readCheckpoint,
      clearCache: fs
        .remove(paths.cacheDirectory, { recursive: true })
        .pipe(Effect.andThen(fs.makeDirectory(paths.cacheDirectory))),
    };
  });
}
