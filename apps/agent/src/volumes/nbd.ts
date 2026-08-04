import type { VolumeId } from '@repo/protocol';
import { Effect } from 'effect';
import { run, stdoutOf } from '#lib/exec.ts';

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

/** `-persist` reconnects on its own, which keeps a ZeroFS restart a stall rather than an I/O error. */
export const attach = ({
  socketPath,
  devicePath,
  volumeId,
}: {
  socketPath: string;
  devicePath: string;
  volumeId: VolumeId;
}) =>
  stdoutOf({
    command: [
      NBD_CLIENT,
      '-unix',
      socketPath,
      devicePath,
      '-N',
      volumeId,
      '-persist',
      '-timeout',
      String(NBD_TIMEOUT_SECONDS),
      '-connections',
      String(NBD_CONNECTIONS),
      '-block-size',
      String(NBD_BLOCK_SIZE_BYTES),
    ],
  });

export const detach = (devicePath: string) => run({ command: [NBD_CLIENT, '-d', devicePath] });
