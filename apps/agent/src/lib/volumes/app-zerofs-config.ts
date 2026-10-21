import { dirname, join } from 'node:path';
import { FileSystem } from '@effect/platform';
import type { AppId } from '@repo/protocol';
import { Data, Effect } from 'effect';
import { renderZerofsConfig } from '#lib/volumes/zerofs-config.ts';
import { AgentConfig } from '#services/agent-config.service.ts';

type AppZerofsConfig = {
  appId: AppId;
  storage: Parameters<typeof renderZerofsConfig>[0]['storage'];
  cache: Omit<Parameters<typeof renderZerofsConfig>[0]['cache'], 'directory'>;
};

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
export const APP_ZEROFS_CONFIG_FILENAME = 'config.toml';

export class AppZerofsConfigConflict extends Data.TaggedError('AppZerofsConfigConflict') {
  override get message() {
    return 'The app already has a different ZeroFS configuration.';
  }
}

export class AppZerofsConfigUnavailable extends Data.TaggedError('AppZerofsConfigUnavailable') {
  override get message() {
    return 'The agent could not stage the app ZeroFS configuration.';
  }
}

export function appZerofsConfigDirectory(stateDir: string) {
  return join(stateDir, 'zerofs');
}

// These paths also appear in nibrun-app-zerofs@.service, which outlives the agent.
export function appZerofsPaths({ appId, stateDir }: { appId: AppId; stateDir: string }) {
  const runtimeDirectory = `/run/zerofs-apps/${appId}`;
  return {
    configFile: join(appZerofsConfigDirectory(stateDir), appId, APP_ZEROFS_CONFIG_FILENAME),
    cacheDirectory: `/data/zerofs-apps/${appId}`,
    mountPath: `/mnt/zerofs-apps/${appId}`,
    sockets: {
      nbd: `${runtimeDirectory}/nbd.sock`,
      ninep: `${runtimeDirectory}/9p.sock`,
      rpc: `${runtimeDirectory}/rpc.sock`,
    },
  };
}

export function appZerofsUnitConfigFile(appId: AppId): string {
  return appZerofsPaths({ appId, stateDir: '/var/lib/nibrun' }).configFile;
}

export function appZerofsConfigContents({
  appId,
  stateDir,
  storage,
  cache,
}: AppZerofsConfig & { stateDir: string }) {
  const paths = appZerofsPaths({ appId, stateDir });
  return renderZerofsConfig({
    storage,
    cache: { ...cache, directory: paths.cacheDirectory },
    sockets: paths.sockets,
    readOnly: false,
  });
}

function publishConfig({ configFile, contents }: { configFile: string; contents: string }) {
  return Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = dirname(configFile);
      yield* fs.makeDirectory(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
      yield* fs.chmod(directory, PRIVATE_DIRECTORY_MODE);
      const temporaryDirectory = yield* fs.makeTempDirectoryScoped({
        directory,
        prefix: '.config-',
      });
      const temporaryFile = join(temporaryDirectory, APP_ZEROFS_CONFIG_FILENAME);
      yield* fs.writeFileString(temporaryFile, contents, { mode: PRIVATE_FILE_MODE, flag: 'wx' });

      // A hard link publishes complete bytes without replacing a concurrent writer's config.
      yield* fs.link(temporaryFile, configFile).pipe(
        Effect.catchTag('SystemError', (error) =>
          error.reason === 'AlreadyExists'
            ? Effect.gen(function* () {
                if ((yield* fs.readFileString(configFile)) !== contents) {
                  return yield* new AppZerofsConfigConflict();
                }
                yield* fs.chmod(configFile, PRIVATE_FILE_MODE);
              })
            : Effect.fail(error),
        ),
      );
    }),
  ).pipe(
    Effect.mapError((error) =>
      error._tag === 'AppZerofsConfigConflict' ? error : new AppZerofsConfigUnavailable(),
    ),
  );
}

export function stageAppZerofsConfig({ appId, storage, cache }: AppZerofsConfig) {
  return Effect.gen(function* () {
    const config = yield* AgentConfig;
    const paths = appZerofsPaths({ appId, stateDir: config.stateDir });
    const contents = appZerofsConfigContents({ appId, stateDir: config.stateDir, storage, cache });
    yield* publishConfig({ configFile: paths.configFile, contents });
    return paths;
  });
}
