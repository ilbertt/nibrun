import { Buffer } from 'node:buffer';
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import { Effect } from 'effect';

export function sqliteHttpBytes(body: Buffer) {
  return Buffer.concat([
    Buffer.from(
      `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.byteLength}\r\nConnection: keep-alive\r\n\r\n`,
    ),
    body,
  ]);
}

export function sqliteHttpResponse(body: unknown) {
  return sqliteHttpBytes(Buffer.from(JSON.stringify(body)));
}

export function sqlitePipelineResponse() {
  return sqliteHttpResponse({
    baton: 'guest-baton',
    base_url: null,
    results: [
      {
        type: 'ok',
        response: {
          type: 'execute',
          result: {
            cols: [{ name: 'value', decltype: 'INTEGER' }],
            rows: [[{ type: 'integer', value: '9223372036854775807' }]],
            affected_row_count: 0,
            last_insert_rowid: null,
          },
        },
      },
    ],
  });
}

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
  const pending = [...responses];
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
    function acceptHandshake() {
      const newline = buffered.indexOf('\n');
      if (newline < 0) {
        return false;
      }
      requests.push(buffered.subarray(0, newline + 1));
      buffered = buffered.subarray(newline + 1);
      accepted = true;
      connected.resolve();
      void send({ socket, bytes: Buffer.from(handshake) });
      return true;
    }
    function receive(bytes: Buffer) {
      buffered = Buffer.concat([buffered, bytes]);
      if (!accepted && !acceptHandshake()) {
        return;
      }
      const headerEnd = buffered.indexOf('\r\n\r\n');
      if (headerEnd < 0) {
        return;
      }
      const header = buffered.subarray(0, headerEnd).toString();
      const contentLength = Number(/content-length: ([0-9]+)/i.exec(header)?.[1] ?? 0);
      const bodyStart = headerEnd + Buffer.byteLength('\r\n\r\n');
      if (buffered.byteLength < bodyStart + contentLength) {
        return;
      }
      const requestLine = header.split('\r\n')[0]?.replace(/ HTTP\/1\.1$/, '') ?? '';
      requests.push(
        Buffer.concat([
          Buffer.from(`${requestLine}\n`),
          buffered.subarray(bodyStart, bodyStart + contentLength),
        ]),
      );
      buffered = buffered.subarray(bodyStart + contentLength);
      const response = pending.shift();
      if (response !== undefined) {
        void send({ socket, bytes: response });
      }
    }
    socket.on('data', receive);
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
