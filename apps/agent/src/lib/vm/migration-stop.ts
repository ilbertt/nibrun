import type { AppId } from '@repo/protocol';
import { Data, Effect, Exit } from 'effect';
import { freezeRunningGuest } from '#lib/exports/freeze.ts';
import { parseProperties } from '#lib/systemd-properties.ts';
import * as Firecracker from '#lib/vm/firecracker-api.ts';
import * as Systemd from '#lib/vm/systemd.ts';
import { stdoutOf } from '#services/command-runner.service.ts';

const STOP_PROPERTIES = ['LoadState', 'ActiveState', 'SubState', 'MainPID', 'ControlPID'];

export class VolumeMigrationSourceStopFailed extends Data.TaggedError(
  'VolumeMigrationSourceStopFailed',
) {
  override get message() {
    return 'The volume migration source VM could not be stopped safely.';
  }
}

function readVmState(appId: AppId) {
  return Effect.gen(function* () {
    const properties = parseProperties(
      yield* stdoutOf({
        command: [
          'systemctl',
          'show',
          Systemd.vmUnitName(appId),
          `--property=${STOP_PROPERTIES.join(',')}`,
        ],
      }),
    );
    if (properties.LoadState !== 'loaded' || properties.ControlPID !== '0') {
      return yield* new VolumeMigrationSourceStopFailed();
    }
    if (
      (properties.ActiveState === 'inactive' || properties.ActiveState === 'failed') &&
      properties.MainPID === '0'
    ) {
      return 'stopped' as const;
    }
    if (
      properties.ActiveState === 'active' &&
      properties.SubState === 'running' &&
      /^[1-9]\d*$/.test(properties.MainPID ?? '')
    ) {
      return 'running' as const;
    }
    return yield* new VolumeMigrationSourceStopFailed();
  });
}

function stopAndVerify(appId: AppId) {
  return Effect.gen(function* () {
    yield* Systemd.stop(appId);
    if ((yield* readVmState(appId)) !== 'stopped') {
      return yield* new VolumeMigrationSourceStopFailed();
    }
  });
}

/** Requires exclusive VM lifecycle ownership. The caller must still flush and detach storage before copying. */
export function stopVmForVolumeMigration({
  appId,
  vmDir,
  runtimeDir,
}: {
  appId: AppId;
  vmDir: string;
  runtimeDir: string;
}) {
  return Effect.scoped(
    Effect.gen(function* () {
      if ((yield* readVmState(appId)) === 'stopped') {
        return yield* stopAndVerify(appId);
      }
      const lease = yield* freezeRunningGuest({ appId, vmDir });
      const socketPath = Systemd.vmApiSocketPath({ runtimeDir, appId });
      // Pausing vCPUs prevents the guest's freeze deadline from expiring during the stop.
      yield* Firecracker.pause(socketPath).pipe(
        // A cancelled pause request must settle before cleanup sends a competing resume.
        Effect.uninterruptible,
        Effect.andThen(lease.assertHeld),
        Effect.andThen(stopAndVerify(appId)),
        Effect.onExit((exit) =>
          Exit.isFailure(exit) ? Firecracker.resume(socketPath).pipe(Effect.ignore) : Effect.void,
        ),
      );
    }),
  ).pipe(
    Effect.mapError(() => new VolumeMigrationSourceStopFailed()),
    Effect.asVoid,
  );
}
