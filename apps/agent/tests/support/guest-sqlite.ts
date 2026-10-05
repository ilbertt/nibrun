import { Buffer } from 'node:buffer';
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import { Effect } from 'effect';
import { SQLITE_HEADER_BYTES, SQLITE_LENGTH_OFFSET } from '#tests/support/sqlite.ts';

export function servingSqliteGuest({
  directory,
  responses,
  fragmented,
  handshake,
}: {
  directory: string;
  responses: readonly Buffer[];
  fragmented: boolean;
  handshake: string;
}) {
  const socketPath = join(directory, 'sqlite.vsock');
  const requests: Buffer[] = [];
  const connected = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  const sockets = new Set<Socket>();
  function disconnect() {
    for (const socket of sockets) {
      socket.destroy();
    }
  }
  async function send({ socket, bytes }: { socket: Socket; bytes: Buffer }) {
    if (!fragmented) {
      socket.write(bytes);
      return;
    }
    for (const byte of bytes) {
      if (socket.destroyed) {
        return;
      }
      socket.write(Buffer.of(byte));
      await Bun.sleep(1);
    }
  }
  const server = createServer((socket) => {
    sockets.add(socket);
    let buffered = Buffer.alloc(0);
    let accepted = false;
    const pending = [...responses];
    function receive() {
      if (!accepted) {
        const newline = buffered.indexOf('\n');
        if (newline < 0) {
          return;
        }
        requests.push(buffered.subarray(0, newline + 1));
        buffered = buffered.subarray(newline + 1);
        accepted = true;
        connected.resolve();
        void send({ socket, bytes: Buffer.from(handshake) });
        return;
      }
      if (
        buffered.byteLength < SQLITE_HEADER_BYTES ||
        buffered.byteLength < SQLITE_HEADER_BYTES + buffered.readUInt32BE(SQLITE_LENGTH_OFFSET)
      ) {
        return;
      }
      const length = SQLITE_HEADER_BYTES + buffered.readUInt32BE(SQLITE_LENGTH_OFFSET);
      requests.push(buffered.subarray(0, length));
      buffered = buffered.subarray(length);
      const response = pending.shift();
      if (response !== undefined) {
        void send({ socket, bytes: response });
      }
    }
    socket.on('data', (bytes) => {
      buffered = Buffer.concat([buffered, Buffer.from(bytes)]);
      receive();
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      sockets.delete(socket);
      closed.resolve();
    });
  });
  return Effect.map(
    Effect.acquireRelease(
      Effect.async<typeof server, Error>((resume) => {
        server.once('error', (error) => resume(Effect.fail(error)));
        server.listen(socketPath, () => resume(Effect.succeed(server)));
      }),
      () =>
        Effect.sync(() => {
          disconnect();
          server.close();
        }),
    ),
    () => ({
      socketPath,
      requests,
      disconnect,
      connected: connected.promise,
      closed: closed.promise,
    }),
  );
}
