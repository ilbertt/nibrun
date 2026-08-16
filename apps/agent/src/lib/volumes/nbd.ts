import type { VolumeId } from '@repo/protocol';
import { Effect } from 'effect';
import { run, stdoutOf } from '#services/command-runner.service.ts';

const NBD_CLIENT = 'nbd-client';
const CONNECTED_EXIT_CODE = 0;

const NBD_CONNECTIONS = 4;
const NBD_BLOCK_SIZE_BYTES = 4096;
/** S3 round trips under load turn a short timeout into an EIO the guest's ext4 answers by
 * remounting read-only. */
const NBD_TIMEOUT_SECONDS = 600;

export const isAttached = (devicePath: string) =>
  Effect.map(
    run({ command: [NBD_CLIENT, '-check', devicePath] }),
    (result) => result.code === CONNECTED_EXIT_CODE,
  );

const connect = ({
  socketPath,
  devicePath,
  volumeId,
  extraArgs,
}: {
  socketPath: string;
  devicePath: string;
  volumeId: VolumeId;
  extraArgs: readonly string[];
}) =>
  stdoutOf({
    command: [
      NBD_CLIENT,
      '-unix',
      socketPath,
      devicePath,
      '-N',
      volumeId,
      ...extraArgs,
      '-timeout',
      String(NBD_TIMEOUT_SECONDS),
      '-connections',
      String(NBD_CONNECTIONS),
      '-block-size',
      String(NBD_BLOCK_SIZE_BYTES),
    ],
  });

/** `-persist` reconnects on its own, which keeps a ZeroFS restart a stall rather than an I/O error. */
export const attach = Effect.fn('nbd.attach')(
  (target: { socketPath: string; devicePath: string; volumeId: VolumeId }) =>
    connect({ ...target, extraArgs: ['-persist'] }),
);

/**
 * A checkpoint server, which is a different kind of peer from the one behind a tenant's disk.
 *
 * No `-persist`: the server is started for one export and stopped after it, so one that died
 * mid-read is not coming back, and reconnecting forever would turn that into a dump that hangs
 * until its own ceiling instead of an export that says what went wrong. No guest is attached
 * here either, so there is no ext4 to remount read-only while it waits.
 *
 * Nothing asks for read-only. A checkpoint server is always read-only, so it advertises the
 * export that way and the kernel marks the device — which holds whether or not this side
 * remembered to ask, unlike a flag.
 */
export const attachCheckpoint = Effect.fn('nbd.attachCheckpoint')(
  (target: { socketPath: string; devicePath: string; volumeId: VolumeId }) =>
    connect({ ...target, extraArgs: [] }),
);

export const detach = Effect.fn('nbd.detach')((devicePath: string) =>
  run({ command: [NBD_CLIENT, '-d', devicePath] }),
);
