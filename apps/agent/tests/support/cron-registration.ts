import { Buffer } from 'node:buffer';
import { createConnection } from 'node:net';

const HEADER_BYTES = 9;
const MAGIC = 'NBC1';
const CODE_OFFSET = MAGIC.length;
const LENGTH_OFFSET = 5;
const RESPONSE_TIMEOUT_MS = 2000;

export function registrationFrame({ code, text }: { code: number; text: string }) {
  const body = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(HEADER_BYTES);
  header.write(MAGIC);
  header[CODE_OFFSET] = code;
  header.writeUInt32BE(body.byteLength, LENGTH_OFFSET);
  return Buffer.concat([header, body]);
}

export async function registrationExchange({
  socketPath,
  parts,
}: {
  socketPath: string;
  parts: readonly Uint8Array[];
}) {
  const socket = createConnection(socketPath);
  const connected = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<Buffer>();
  const response: Buffer[] = [];
  const timer = setTimeout(
    () => closed.reject(new Error('The registration reply did not arrive.')),
    RESPONSE_TIMEOUT_MS,
  );
  socket.once('connect', connected.resolve);
  socket.once('error', connected.reject);
  socket.on('data', (chunk) =>
    response.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk),
  );
  socket.once('end', () => closed.resolve(Buffer.concat(response)));
  socket.once('error', closed.reject);
  try {
    await connected.promise;
    for (const part of parts) {
      socket.write(part);
      await Bun.sleep(1);
    }
    const bytes = await closed.promise;
    if (
      bytes.subarray(0, CODE_OFFSET).toString() !== MAGIC ||
      bytes.byteLength !== HEADER_BYTES + bytes.readUInt32BE(LENGTH_OFFSET)
    ) {
      throw new Error('The registration reply was not one complete frame.');
    }
    return { status: bytes[CODE_OFFSET], text: bytes.subarray(HEADER_BYTES).toString() };
  } finally {
    clearTimeout(timer);
    socket.destroy();
  }
}
