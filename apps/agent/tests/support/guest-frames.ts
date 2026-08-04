import { Buffer } from 'node:buffer';

/**
 * The wire format restated rather than imported from the decoder: a codec checked with its own
 * encoder agrees with itself whatever the two of them drift into writing.
 */
const MAGIC = Buffer.from('NBL1');
const HEADER_BYTES = 9;
const KIND_OFFSET = 4;
const KINDS = { stdout: 1, stderr: 2, gap: 3 } as const;

export const PAYLOAD_LENGTH_OFFSET = 5;
export const GAP_PAYLOAD_BYTES = 8;

export function guestLogFrame({
  kind,
  payload,
}: {
  kind: keyof typeof KINDS;
  payload: Uint8Array;
}): Buffer {
  const header = Buffer.alloc(HEADER_BYTES);
  MAGIC.copy(header);
  header[KIND_OFFSET] = KINDS[kind];
  header.writeUInt32BE(payload.byteLength, PAYLOAD_LENGTH_OFFSET);
  return Buffer.concat([header, payload]);
}

export function gapFrame(droppedBytes: bigint): Buffer {
  const payload = Buffer.alloc(GAP_PAYLOAD_BYTES);
  payload.writeBigUInt64BE(droppedBytes);
  return guestLogFrame({ kind: 'gap', payload });
}
