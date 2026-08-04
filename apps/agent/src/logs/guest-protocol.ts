import { Buffer } from 'node:buffer';
import type { TenantLogStream } from '@repo/protocol';

const FRAME_MAGIC = Buffer.from('NBL1');
const FRAME_HEADER_BYTES = 9;
const MAX_FRAME_PAYLOAD_BYTES = 65_536;
const GAP_PAYLOAD_BYTES = 8;

const FRAME_KINDS = {
  stdout: 1,
  stderr: 2,
  gap: 3,
} as const;

type GuestLogFrame =
  | { kind: 'data'; stream: TenantLogStream; bytes: Uint8Array }
  | { kind: 'gap'; droppedBytes: number };

export class InvalidGuestLogFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidGuestLogFrameError';
  }
}

export class GuestLogFrameDecoder {
  #buffer = Buffer.alloc(0);

  push(chunk: Uint8Array): GuestLogFrame[] {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    const frames: GuestLogFrame[] = [];
    while (this.#buffer.byteLength >= FRAME_HEADER_BYTES) {
      if (!this.#buffer.subarray(0, FRAME_MAGIC.byteLength).equals(FRAME_MAGIC)) {
        throw new InvalidGuestLogFrameError('guest log frame has an invalid magic value');
      }
      const kind = this.#buffer[FRAME_MAGIC.byteLength];
      const payloadLength = this.#buffer.readUInt32BE(FRAME_MAGIC.byteLength + 1);
      if (payloadLength > MAX_FRAME_PAYLOAD_BYTES) {
        throw new InvalidGuestLogFrameError('guest log frame exceeds the payload limit');
      }
      const frameLength = FRAME_HEADER_BYTES + payloadLength;
      if (this.#buffer.byteLength < frameLength) {
        break;
      }
      const payload = this.#buffer.subarray(FRAME_HEADER_BYTES, frameLength);
      frames.push(frameFrom({ kind, payload }));
      this.#buffer = this.#buffer.subarray(frameLength);
    }
    return frames;
  }
}

function frameFrom({
  kind,
  payload,
}: {
  kind: number | undefined;
  payload: Buffer;
}): GuestLogFrame {
  if (kind === FRAME_KINDS.stdout || kind === FRAME_KINDS.stderr) {
    return {
      kind: 'data',
      stream: kind === FRAME_KINDS.stdout ? 'stdout' : 'stderr',
      bytes: Uint8Array.from(payload),
    };
  }
  if (kind === FRAME_KINDS.gap) {
    if (payload.byteLength !== GAP_PAYLOAD_BYTES) {
      throw new InvalidGuestLogFrameError('guest log gap has an invalid payload length');
    }
    const encoded = payload.readBigUInt64BE();
    return {
      kind: 'gap',
      droppedBytes: Number(
        encoded > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : encoded,
      ),
    };
  }
  throw new InvalidGuestLogFrameError('guest log frame has an unknown kind');
}

export function encodeGuestLogFrameForTest({
  kind,
  payload,
}: {
  kind: keyof typeof FRAME_KINDS;
  payload: Uint8Array;
}): Uint8Array {
  const header = Buffer.alloc(FRAME_HEADER_BYTES);
  FRAME_MAGIC.copy(header);
  header[FRAME_MAGIC.byteLength] = FRAME_KINDS[kind];
  header.writeUInt32BE(payload.byteLength, FRAME_MAGIC.byteLength + 1);
  return Buffer.concat([header, payload]);
}
