import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppId } from '@repo/protocol';
import { Effect } from 'effect';
import { GUEST_VSOCK_FILENAME } from '#lib/vm/vsock.ts';

const CONNECT_GRANTED = 'OK 1024\n';
const FREEZE_HELD = 'OK\n';
const CONNECT_REQUEST = 'CONNECT';

export type GuestBehaviour = {
  readonly onConnect?: string;
  readonly onFreeze?: string;
  readonly hangUpAfterFreezing?: boolean;
};

export type FakeGuest = {
  /** Held between the guest granting a freeze and the host letting go of the connection. */
  readonly isFrozen: () => boolean;
  /**
   * Settles when the host drops the connection, which is the only thing that thaws a guest.
   * Waiting on it inside a step of an export is how a test asks which side of the thaw that step
   * fell on: if the freeze outlived it, nothing resolves this and the test hangs rather than
   * passing on an ordering that happened to hold.
   */
  readonly thawed: Promise<void>;
};

/**
 * Firecracker's end of the vsock device, which is a plain unix socket speaking a text handshake
 * before the stream becomes the guest's. Standing it up for real is the only way to cover the part
 * that matters: what the agent does when the answer is not the one it wanted.
 */
export function fakeGuest({
  vmDir,
  appId,
  behaviour = {},
}: {
  vmDir: string;
  appId: AppId;
  behaviour?: GuestBehaviour;
}) {
  return Effect.acquireRelease(
    Effect.promise(async () => {
      const workingDir = join(vmDir, appId);
      await mkdir(workingDir, { recursive: true });
      const {
        onConnect = CONNECT_GRANTED,
        onFreeze = FREEZE_HELD,
        hangUpAfterFreezing = false,
      } = behaviour;
      let frozen = false;
      let letGo = () => {};
      const thawed = new Promise<void>((resolve) => {
        letGo = resolve;
      });
      const server = Bun.listen({
        unix: join(workingDir, GUEST_VSOCK_FILENAME),
        socket: {
          // biome-ignore lint/complexity/useMaxParams: Bun hands a socket handler its own socket
          data: (socket, chunk) => {
            if (chunk.toString().startsWith(CONNECT_REQUEST)) {
              socket.write(onConnect);
              return;
            }
            socket.write(onFreeze);
            frozen = onFreeze === FREEZE_HELD && !hangUpAfterFreezing;
            if (hangUpAfterFreezing) {
              socket.end();
            }
          },
          close: () => {
            frozen = false;
            letGo();
          },
        },
      });
      return { server, isFrozen: () => frozen, thawed } satisfies FakeGuest & { server: unknown };
    }),
    ({ server }) => Effect.sync(() => server.stop(true)),
  );
}
