import { Buffer } from 'node:buffer';
import { join } from 'node:path';
import type { AppId } from '@repo/protocol';
import { Data, Either } from 'effect';

/**
 * One vsock device per microVM, and every port multiplexes over it — which is why this names the
 * device rather than what any one port carries. The host dials a guest port by connecting here
 * and asking; the guest's own outbound connections arrive on `<path>_<port>` instead.
 *
 * The value is what the tenant log port made it before anything else shared the device, and it
 * stays: a guest booted by an earlier agent is listening on this path, and renaming it would make
 * an export of that VM find nothing, conclude no VMM was running, and read the volume unfrozen —
 * the one outcome the freeze exists to prevent.
 */
export const GUEST_VSOCK_FILENAME = 'logs.vsock';

/** Answered by the control process in the guest's PID 1. `apps/runtime/src/vsock.h` is the other end. */
export const GUEST_CONTROL_VSOCK_PORT = 51001;

/**
 * Answered by a second process beside it, on a port of its own because the control port
 * serialises: it takes one connection at a time and a granted freeze holds it for as long as an
 * export reads the device. Browsing a filesystem must never queue behind that.
 */
export const GUEST_FILESYSTEM_VSOCK_PORT = 51002;

export const vmWorkingDir = ({ vmDir, appId }: { vmDir: string; appId: AppId }): string =>
  join(vmDir, appId);

export const guestVsockPath = ({ workingDir }: { workingDir: string }): string =>
  join(workingDir, GUEST_VSOCK_FILENAME);

export class GuestPortUnreachable extends Data.TaggedError('GuestPortUnreachable')<{
  readonly port: number;
  readonly reply: string;
}> {
  override get message() {
    return `nothing in the guest answered vsock port ${this.port}: ${this.reply}`;
  }
}

/**
 * Firecracker's host-initiated leg is a text handshake before the stream becomes the guest's:
 * `CONNECT <port>` in, `OK <host-side port>` back. Anything else means the VMM is there and the
 * guest is not listening, which is a different thing from no VMM at all — the socket refusing the
 * connection outright is what says that.
 */
export const connectRequest = (port: number): string => `CONNECT ${port}\n`;

const CONNECT_ACCEPTED = 'OK ';

export function readConnectReply({
  reply,
  port,
}: {
  reply: string;
  port: number;
}): Either.Either<void, GuestPortUnreachable> {
  return reply.startsWith(CONNECT_ACCEPTED)
    ? Either.right(undefined)
    : Either.left(new GuestPortUnreachable({ port, reply }));
}

/**
 * One connection to one guest's vsock device.
 *
 * Both readers exist because the handshake above is a line and everything after it is whatever
 * the port carries — a line for the control port, framed bytes for the filesystem one. Neither
 * resolves until it has what it was asked for, and both reject the moment the guest lets go, so
 * a caller never has to ask whether a short read meant anything.
 */
export type GuestWire = {
  readonly send: (bytes: string | Uint8Array) => void;
  readonly receiveLine: () => Promise<string>;
  readonly receive: (count: number) => Promise<Buffer>;
  readonly isOpen: () => boolean;
  readonly close: () => void;
};

export async function dialGuest({ socketPath }: { socketPath: string }): Promise<GuestWire> {
  let buffered = Buffer.alloc(0);
  let open = true;
  let waiting: (() => void) | undefined;

  const socket = await Bun.connect({
    unix: socketPath,
    socket: {
      // biome-ignore lint/complexity/useMaxParams: Bun hands a socket handler its own socket
      data: (_socket, chunk) => {
        buffered = Buffer.concat([buffered, chunk]);
        waiting?.();
      },
      close: () => {
        open = false;
        waiting?.();
      },
      error: () => {
        open = false;
        waiting?.();
      },
    },
  });

  function take(count: number): Buffer | undefined {
    if (buffered.byteLength < count) {
      return undefined;
    }
    const taken = buffered.subarray(0, count);
    buffered = buffered.subarray(count);
    return taken;
  }

  function takeLine(): string | undefined {
    const end = buffered.indexOf('\n');
    if (end < 0) {
      return undefined;
    }
    const line = buffered.subarray(0, end).toString();
    buffered = buffered.subarray(end + 1);
    return line;
  }

  function awaiting<A>(pull: () => A | undefined): Promise<A> {
    // biome-ignore lint/complexity/useMaxParams: an executor settles two ways
    return new Promise((resolve, reject) => {
      function attempt() {
        const pulled = pull();
        if (pulled !== undefined) {
          waiting = undefined;
          resolve(pulled);
          return;
        }
        if (!open) {
          waiting = undefined;
          reject(new Error(`${socketPath} closed before it answered`));
        }
      }
      waiting = attempt;
      attempt();
    });
  }

  return {
    send: (bytes) => {
      socket.write(bytes);
    },
    isOpen: () => open,
    close: () => {
      socket.end();
    },
    receiveLine: () => awaiting(takeLine),
    receive: (count) => awaiting(() => take(count)),
  };
}
