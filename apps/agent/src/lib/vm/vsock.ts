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
