import type { AppId } from '@repo/protocol';
import { Data, Effect } from 'effect';
import { appZerofsPaths } from '#lib/volumes/app-zerofs-config.ts';
import { stopAppZerofs } from '#lib/volumes/app-zerofs-systemd.ts';
import { flush } from '#lib/volumes/zerofs.ts';
import { AgentConfig } from '#services/agent-config.service.ts';

export class AppZerofsFlushError extends Data.TaggedError('AppZerofsFlushError') {
  override get message() {
    return 'The agent could not flush the app ZeroFS filesystem.';
  }
}

export function flushAppZerofs(appId: AppId) {
  return Effect.gen(function* () {
    const config = yield* AgentConfig;
    const paths = appZerofsPaths({ appId, stateDir: config.stateDir });
    yield* flush({ binary: config.zerofsBinary, configFile: paths.configFile }).pipe(
      Effect.mapError(() => new AppZerofsFlushError()),
    );
  });
}

/** Callers must stop guest writes and detach clients before taking this durability barrier. */
export function flushAndStopAppZerofs(appId: AppId) {
  return flushAppZerofs(appId).pipe(Effect.andThen(stopAppZerofs(appId)));
}
