import type { AppId } from '@repo/protocol';
import { Data, Effect } from 'effect';
import { appZerofsPaths } from '#lib/volumes/app-zerofs-config.ts';
import type { ZerofsLiveFilesystem } from '#lib/volumes/topology.ts';
import { AgentConfig } from '#services/agent-config.service.ts';

export class AppZerofsFilesystemUnavailable extends Data.TaggedError(
  'AppZerofsFilesystemUnavailable',
) {
  override get message() {
    return 'The requested app filesystem is not ready on this host.';
  }
}

export class AppZerofsFilesystemConflict extends Data.TaggedError('AppZerofsFilesystemConflict') {
  override get message() {
    return 'The app ZeroFS filesystem conflicts with an existing registration.';
  }
}

export function appZerofsFilesystem({
  appId,
  storagePrefix,
}: {
  appId: AppId;
  storagePrefix: ZerofsLiveFilesystem['storagePrefix'];
}): Effect.Effect<ZerofsLiveFilesystem, never, AgentConfig> {
  return Effect.gen(function* () {
    const config = yield* AgentConfig;
    const paths = appZerofsPaths({ appId, stateDir: config.stateDir });
    return {
      storagePrefix,
      mountPath: paths.mountPath,
      nbdSocketPath: paths.sockets.nbd,
      admin: { binary: config.zerofsBinary, configFile: paths.configFile },
    } satisfies ZerofsLiveFilesystem;
  });
}
