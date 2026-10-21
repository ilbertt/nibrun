import { Data, Effect } from 'effect';
import { appZerofsPaths, appZerofsUnitConfigFile } from '#lib/volumes/app-zerofs-config.ts';
import { appZerofsFilesystem } from '#lib/volumes/app-zerofs-filesystem.ts';
import { observeAppZerofs } from '#lib/volumes/app-zerofs-observation.ts';
import { prepareAppZerofs } from '#lib/volumes/app-zerofs-preparation.ts';
import { startAppZerofs } from '#lib/volumes/app-zerofs-systemd.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';

export class AppZerofsConfigPathMismatch extends Data.TaggedError('AppZerofsConfigPathMismatch') {
  override get message() {
    return 'The app ZeroFS configuration path does not match its systemd unit.';
  }
}

export class AppZerofsNotReady extends Data.TaggedError('AppZerofsNotReady') {
  override get message() {
    return 'The app ZeroFS services are not ready.';
  }
}

/** Requires exclusive fleet ownership of the storage prefix for the instance's lifetime. */
export function activateAppZerofs(config: Parameters<typeof prepareAppZerofs>[0]) {
  return Effect.gen(function* () {
    const agent = yield* AgentConfig;
    const topology = yield* ZerofsTopology;
    const configured = appZerofsPaths({ appId: config.appId, stateDir: agent.stateDir });
    if (configured.configFile !== appZerofsUnitConfigFile(config.appId)) {
      return yield* new AppZerofsConfigPathMismatch();
    }
    yield* prepareAppZerofs(config);
    // A partial start can leave an existing writer alive; failed activation must not roll it back.
    yield* startAppZerofs(config.appId);
    const observed = yield* observeAppZerofs(config.appId);
    if (!observed.ready) {
      return yield* new AppZerofsNotReady();
    }
    const filesystem = yield* appZerofsFilesystem({
      appId: config.appId,
      storagePrefix: config.storage.prefix,
    });
    yield* topology.registerAppFilesystem({
      appId: config.appId,
      filesystem,
      storage: config.storage,
    });
    return filesystem;
  });
}
