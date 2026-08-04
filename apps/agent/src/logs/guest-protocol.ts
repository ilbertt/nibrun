import { Buffer } from 'node:buffer';
import type { TenantLogStream } from '@repo/protocol';
import { Data, Either } from 'effect';

const FRAME_MAGIC = Buffer.from('NBL1');
const FRAME_HEADER_BYTES = 9;
const KIND_OFFSET = FRAME_MAGIC.byteLength;
const LENGTH_OFFSET = KIND_OFFSET + 1;
const MAX_FRAME_PAYLOAD_BYTES = 65_536;
const GAP_PAYLOAD_BYTES = 8;

const FRAME_KINDS = { stdout: 1, stderr: 2, gap: 3 } as const;

export type GuestLogFrame =
  | { readonly kind: 'data'; readonly stream: TenantLogStream; readonly bytes: Uint8Array }
  | { readonly kind: 'gap'; readonly droppedBytes: number };

export class InvalidGuestLogFrame extends Data.TaggedError('InvalidGuestLogFrame')<{
  readonly reason: string;
}> {}

export const EMPTY_BUFFER: Buffer = Buffer.alloc(0);

export type DecodedFrames = {
  readonly frames: readonly GuestLogFrame[];
  readonly rest: Buffer;
};

/** Frames survive arbitrary transport chunking, so `rest` carries the partial frame forward. */
export function decodeFrames({
  buffered,
  chunk,
}: {
  buffered: Buffer;
  chunk: Uint8Array;
}): Either.Either<DecodedFrames, InvalidGuestLogFrame> {
  let rest = Buffer.concat([buffered, chunk]);
  const frames: GuestLogFrame[] = [];
  while (rest.byteLength >= FRAME_HEADER_BYTES) {
    if (!rest.subarray(0, FRAME_MAGIC.byteLength).equals(FRAME_MAGIC)) {
      return Either.left(new InvalidGuestLogFrame({ reason: 'invalid magic value' }));
    }
    const payloadLength = rest.readUInt32BE(LENGTH_OFFSET);
    if (payloadLength > MAX_FRAME_PAYLOAD_BYTES) {
      return Either.left(new InvalidGuestLogFrame({ reason: 'payload exceeds the limit' }));
    }
    const frameLength = FRAME_HEADER_BYTES + payloadLength;
    if (rest.byteLength < frameLength) {
      break;
    }
    const frame = frameFrom({
      kind: rest[KIND_OFFSET],
      payload: rest.subarray(FRAME_HEADER_BYTES, frameLength),
    });
    if (Either.isLeft(frame)) {
      return Either.left(frame.left);
    }
    frames.push(frame.right);
    rest = rest.subarray(frameLength);
  }
  return Either.right({ frames, rest });
}

function frameFrom({
  kind,
  payload,
}: {
  kind: number | undefined;
  payload: Buffer;
}): Either.Either<GuestLogFrame, InvalidGuestLogFrame> {
  if (kind === FRAME_KINDS.stdout || kind === FRAME_KINDS.stderr) {
    return Either.right({
      kind: 'data',
      stream: kind === FRAME_KINDS.stdout ? 'stdout' : 'stderr',
      bytes: Uint8Array.from(payload),
    });
  }
  if (kind !== FRAME_KINDS.gap) {
    return Either.left(new InvalidGuestLogFrame({ reason: 'unknown frame kind' }));
  }
  if (payload.byteLength !== GAP_PAYLOAD_BYTES) {
    return Either.left(new InvalidGuestLogFrame({ reason: 'invalid gap payload length' }));
  }
  const encoded = payload.readBigUInt64BE();
  return Either.right({
    kind: 'gap',
    droppedBytes: Number(
      encoded > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : encoded,
    ),
  });
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
  header[KIND_OFFSET] = FRAME_KINDS[kind];
  header.writeUInt32BE(payload.byteLength, LENGTH_OFFSET);
  return Buffer.concat([header, payload]);
}
