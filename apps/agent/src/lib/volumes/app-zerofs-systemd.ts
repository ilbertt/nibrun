import type { AppId } from '@repo/protocol';
import { Data, Effect } from 'effect';
import { stdoutOf } from '#services/command-runner.service.ts';

const START_TIMEOUT = '3 minutes';
const STOP_TIMEOUT = '5 minutes';

export class AppZerofsUnitError extends Data.TaggedError('AppZerofsUnitError')<{
  readonly operation: 'start' | 'stop';
}> {
  override get message() {
    return `The agent could not ${this.operation} the app ZeroFS services.`;
  }
}

export function appZerofsUnits(appId: AppId) {
  return {
    server: `nibrun-app-zerofs@${appId}.service`,
    mount: `nibrun-app-zerofs-mount@${appId}.service`,
  };
}

/** Requires prepared config/cache and exclusive fleet ownership of the storage prefix. */
export function startAppZerofs(appId: AppId) {
  const units = appZerofsUnits(appId);
  // BindsTo pulls in the server; After waits for its listeners before mounting.
  return stdoutOf({
    command: ['systemctl', 'start', units.mount],
    timeout: START_TIMEOUT,
  }).pipe(
    Effect.asVoid,
    Effect.mapError(() => new AppZerofsUnitError({ operation: 'start' })),
  );
}

/** Call only after guests are detached and their writes have been flushed successfully. */
export function stopAppZerofs(appId: AppId) {
  const units = appZerofsUnits(appId);
  // One transaction applies the units' reverse ordering: unmount before stopping the writer.
  return stdoutOf({
    command: ['systemctl', 'stop', units.mount, units.server],
    timeout: STOP_TIMEOUT,
  }).pipe(
    Effect.asVoid,
    Effect.mapError(() => new AppZerofsUnitError({ operation: 'stop' })),
  );
}
