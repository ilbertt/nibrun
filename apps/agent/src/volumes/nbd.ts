import type { VolumeId } from '@repo/protocol';
import { NBD_BLOCK_SIZE_BYTES, NBD_CONNECTIONS, NBD_TIMEOUT_SECONDS } from '#config.ts';
import { type CommandRunner, runCommandOrThrow } from '#lib/exec.ts';

const NBD_CLIENT = 'nbd-client';
const CONNECTED_EXIT_CODE = 0;

export async function isAttached({
  runner,
  devicePath,
}: {
  runner: CommandRunner;
  devicePath: string;
}): Promise<boolean> {
  const result = await runner({ command: [NBD_CLIENT, '-check', devicePath] });
  return result.code === CONNECTED_EXIT_CODE;
}

/**
 * `-persist` reconnects on its own, and a long timeout is what keeps a ZeroFS restart a stall
 * rather than an I/O error: the kernel returns EIO once the timeout lapses, and the guest's
 * ext4 answers an EIO by remounting itself read-only.
 */
export async function attach({
  runner,
  socketPath,
  devicePath,
  volumeId,
}: {
  runner: CommandRunner;
  socketPath: string;
  devicePath: string;
  volumeId: VolumeId;
}): Promise<void> {
  await runCommandOrThrow({
    runner,
    request: {
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
    },
  });
}

export async function detach({
  runner,
  devicePath,
}: {
  runner: CommandRunner;
  devicePath: string;
}): Promise<void> {
  await runner({ command: [NBD_CLIENT, '-d', devicePath] });
}
