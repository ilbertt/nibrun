import type { AppId } from '@repo/protocol';
import { Data, Effect } from 'effect';
import { parsePropertyBlocks } from '#lib/systemd-properties.ts';
import { appZerofsUnits } from '#lib/volumes/app-zerofs-systemd.ts';
import { stdoutOf } from '#services/command-runner.service.ts';

type AppZerofsUnitState = {
  readonly loadState: string;
  readonly activeState: string;
  readonly subState: string;
};

const SHOWN_PROPERTIES = ['Id', 'LoadState', 'ActiveState', 'SubState'];

export class AppZerofsObservationError extends Data.TaggedError('AppZerofsObservationError') {
  override get message() {
    return 'The agent could not read the app ZeroFS service states.';
  }
}

function unitState(properties: Record<string, string> | undefined): AppZerofsUnitState | undefined {
  if (!(properties?.LoadState && properties.ActiveState && properties.SubState)) {
    return undefined;
  }
  return {
    loadState: properties.LoadState,
    activeState: properties.ActiveState,
    subState: properties.SubState,
  };
}

function isRunning(state: AppZerofsUnitState): boolean {
  return (
    state.loadState === 'loaded' && state.activeState === 'active' && state.subState === 'running'
  );
}

export function observeAppZerofs(appId: AppId) {
  return Effect.gen(function* () {
    const units = appZerofsUnits(appId);
    const output = yield* stdoutOf({
      command: [
        'systemctl',
        'show',
        units.server,
        units.mount,
        `--property=${SHOWN_PROPERTIES.join(',')}`,
      ],
    }).pipe(Effect.mapError(() => new AppZerofsObservationError()));
    const records = parsePropertyBlocks(output);
    const byId = new Map(records.map((record) => [record.Id, record]));
    const server = unitState(byId.get(units.server));
    const mount = unitState(byId.get(units.mount));
    if (
      records.length !== Object.keys(units).length ||
      byId.size !== records.length ||
      !server ||
      !mount
    ) {
      return yield* new AppZerofsObservationError();
    }
    return { server, mount, ready: isRunning(server) && isRunning(mount) };
  });
}
