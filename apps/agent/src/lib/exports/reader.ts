import { Path } from '@effect/platform';
import type { CheckpointId, VolumeId } from '@repo/protocol';
import { Effect } from 'effect';
import { EXPORT_READER_DEVICE_PATH } from '#lib/network/slot.ts';
import { attachCheckpoint, detach } from '#lib/volumes/nbd.ts';
import type { ZerofsFilesystem } from '#lib/volumes/topology.ts';
import { run, stdoutOf } from '#services/command-runner.service.ts';

const SYSTEMCTL = 'systemctl';
const UNIT_TEMPLATE = 'nibrun-zerofs-checkpoint@';
const UNIT_SUFFIX = '.service';
/** `[servers.nbd] unix_socket` in infra/app-host/zerofs/checkpoint.toml, under the unit's `%i`. */
const NBD_SOCKET_FILENAME = 'nbd.sock';

export const checkpointServerUnit = (checkpointId: CheckpointId) =>
  `${UNIT_TEMPLATE}${checkpointId}${UNIT_SUFFIX}`;

const socketPathFor = ({
  filesystem,
  checkpointId,
  path,
}: {
  filesystem: ZerofsFilesystem;
  checkpointId: CheckpointId;
  path: Path.Path;
}) => path.join(filesystem.checkpointRuntimeDir, checkpointId, NBD_SOCKET_FILENAME);

/**
 * `systemctl start` returning is what readiness rests on, and only because the unit ends with an
 * `ExecStartPost` that waits for the socket: `Type=exec` calls a process started the moment it
 * execs, which for ZeroFS is well before it is answering on anything.
 */
const startServer = Effect.fn('checkpointServer.start')((checkpointId: CheckpointId) =>
  stdoutOf({ command: [SYSTEMCTL, 'start', checkpointServerUnit(checkpointId)] }),
);

/**
 * Tolerated rather than checked, because this also runs on the way out of an export that already
 * failed, where an error here would replace the reason it failed with the reason its cleanup did.
 * `reset-failed` after it: an instance that exited badly stays loaded and failed forever, and
 * nothing on this host enumerates these units to notice.
 */
export const stopCheckpointServer = Effect.fn('checkpointServer.stop')(
  (checkpointId: CheckpointId) =>
    run({ command: [SYSTEMCTL, 'stop', checkpointServerUnit(checkpointId)] }).pipe(
      Effect.andThen(
        run({ command: [SYSTEMCTL, 'reset-failed', checkpointServerUnit(checkpointId)] }),
      ),
      Effect.ignore,
    ),
);

/** Harmless on a device nothing is attached to, which is what lets the reap run it unconditionally. */
export const detachReader = detach(EXPORT_READER_DEVICE_PATH).pipe(
  Effect.ignore,
  Effect.withSpan('checkpointServer.detach'),
);

/**
 * A checkpoint's filesystem as a block device, for as long as the scope lives.
 *
 * Two acquisitions rather than one, so that an attach which fails still stops the server it
 * started. Both are released in reverse: the device goes first, because taking the socket away
 * from a kernel client that still holds it is how a `nbd-client -d` turns into a hang.
 */
export const attachedCheckpoint = Effect.fn('attachedCheckpoint')(function* ({
  filesystem,
  checkpointId,
  volumeId,
}: {
  filesystem: ZerofsFilesystem;
  checkpointId: CheckpointId;
  volumeId: VolumeId;
}) {
  const path = yield* Path.Path;
  yield* Effect.acquireRelease(startServer(checkpointId), () => stopCheckpointServer(checkpointId));
  yield* Effect.acquireRelease(
    attachCheckpoint({
      socketPath: socketPathFor({ filesystem, checkpointId, path }),
      devicePath: EXPORT_READER_DEVICE_PATH,
      volumeId,
    }),
    () => detachReader,
  );
  return EXPORT_READER_DEVICE_PATH;
});
