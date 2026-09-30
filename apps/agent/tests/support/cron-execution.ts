import { Buffer } from 'node:buffer';
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import { Effect } from 'effect';

export const CRON_HEADER_BYTES = 9;
export const CRON_CODE_OFFSET = 4;
export const CRON_LENGTH_OFFSET = 5;
export const CRON_UINT32_BYTES = 4;
export const CRON_REPLY = { started: 1, stdout: 2, stderr: 3, exit: 4, rejected: 5 } as const;

export type CronGuestScript = {
  readonly connectReply: string;
  readonly frames: readonly Buffer[];
  readonly fragmented: boolean;
  readonly closeAfterFrames: boolean;
};

export function cronReplyFrame({ code, body }: { code: number; body: Uint8Array }) {
  const header = Buffer.alloc(CRON_HEADER_BYTES);
  header.write('NBR1');
  header[CRON_CODE_OFFSET] = code;
  header.writeUInt32BE(body.byteLength, CRON_LENGTH_OFFSET);
  return Buffer.concat([header, body]);
}

export function cronExitFrame({ exitCode, signal }: { exitCode: number; signal: number }) {
  const body = Buffer.alloc(CRON_UINT32_BYTES * 2);
  body.writeUInt32BE(exitCode);
  body.writeUInt32BE(signal, CRON_UINT32_BYTES);
  return cronReplyFrame({ code: CRON_REPLY.exit, body });
}

export function cronGuestScript(overrides: Partial<CronGuestScript> = {}): CronGuestScript {
  return {
    connectReply: 'OK 1024\n',
    frames: [
      cronReplyFrame({ code: 1, body: Buffer.alloc(0) }),
      cronExitFrame({ exitCode: 0, signal: 0 }),
    ],
    fragmented: false,
    closeAfterFrames: true,
    ...overrides,
  };
}

export function cronRequestContents(bytes: Buffer) {
  const body = bytes.subarray(CRON_HEADER_BYTES);
  let position = 0;
  function field() {
    const length = body.readUInt32BE(position);
    position += CRON_UINT32_BYTES;
    const text = body.subarray(position, position + length).toString('utf8');
    position += length;
    return text;
  }
  const command = field();
  const count = body.readUInt32BE(position);
  position += CRON_UINT32_BYTES;
  const environment = Array.from({ length: count }, field);
  return {
    magic: bytes.subarray(0, CRON_CODE_OFFSET).toString(),
    code: bytes[CRON_CODE_OFFSET],
    command,
    environment,
    trailing: body.byteLength - position,
  };
}

async function sendParts({
  socket,
  bytes,
  fragmented,
}: {
  socket: Socket;
  bytes: Buffer;
  fragmented: boolean;
}) {
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

export function servingCronGuest({
  directory,
  script,
}: {
  directory: string;
  script: CronGuestScript;
}) {
  const socketPath = join(directory, 'cron.vsock');
  const received: ReturnType<typeof cronRequestContents>[] = [];
  const acknowledgements: number[] = [];
  const connectRequests: string[] = [];
  const connected = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  const sockets = new Set<Socket>();
  function disconnect() {
    for (const socket of sockets) {
      socket.destroy();
    }
  }
  const server = createServer((socket) => {
    sockets.add(socket);
    const pending = [...script.frames];
    let phase: 'connect' | 'request' | 'acknowledgement' = 'connect';
    let buffered = Buffer.alloc(0);

    function advance() {
      const frame = pending.shift();
      if (frame === undefined) {
        return;
      }
      const last = pending.length === 0;
      void sendParts({ socket, bytes: frame, fragmented: script.fragmented }).then(() => {
        if (last && script.closeAfterFrames) {
          socket.end();
        }
      });
    }

    function receiveConnect() {
      const newline = buffered.indexOf('\n');
      if (newline < 0) {
        return;
      }
      connectRequests.push(buffered.subarray(0, newline + 1).toString());
      connected.resolve();
      buffered = buffered.subarray(newline + 1);
      phase = 'request';
      void sendParts({
        socket,
        bytes: Buffer.from(script.connectReply),
        fragmented: script.fragmented,
      });
    }

    function receiveRequest() {
      if (
        buffered.byteLength < CRON_HEADER_BYTES ||
        buffered.byteLength < CRON_HEADER_BYTES + buffered.readUInt32BE(CRON_LENGTH_OFFSET)
      ) {
        return;
      }
      received.push(cronRequestContents(buffered));
      buffered = Buffer.alloc(0);
      phase = 'acknowledgement';
      advance();
    }

    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, Buffer.from(chunk)]);
      if (phase === 'connect') {
        receiveConnect();
        return;
      }
      if (phase === 'request') {
        receiveRequest();
        return;
      }
      for (const byte of buffered) {
        acknowledgements.push(byte);
        advance();
      }
      buffered = Buffer.alloc(0);
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
      (listening) =>
        Effect.sync(() => {
          disconnect();
          listening.close();
        }),
    ),
    () => ({
      socketPath,
      received,
      acknowledgements,
      connectRequests,
      disconnect,
      connected: connected.promise,
      closed: closed.promise,
    }),
  );
}
