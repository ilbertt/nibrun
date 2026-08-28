import { Buffer } from 'node:buffer';
import type { FilesystemEntry, FilesystemEntryKind } from '@repo/protocol';

/**
 * The guest's half of the filesystem protocol, spelled out in bytes rather than produced by the
 * code under test — which is the only way a test can tell an encoder that is wrong from a decoder
 * that is wrong the same way. `apps/runtime/src/guest-filesystem.h` is what these follow.
 */

const FRAME_MAGIC = Buffer.from('NBF1');
const CODE_OFFSET = FRAME_MAGIC.byteLength;
const LENGTH_OFFSET = CODE_OFFSET + 1;
const UINT32_BYTES = 4;
const HEADER_BYTES = LENGTH_OFFSET + UINT32_BYTES;
const DETAILS_BYTES = 17;
const SIZE_OFFSET = 1;
const MODIFIED_OFFSET = 9;
const MS_PER_SECOND = 1000;

export const GUEST_STATUS = {
  ok: 0,
  notFound: 1,
  wrongKind: 2,
  exists: 3,
  notEmpty: 4,
  denied: 5,
  malformed: 6,
  failed: 7,
} as const;

export const GUEST_VERB = {
  list: 1,
  stat: 2,
  read: 3,
  write: 4,
  makeDirectory: 5,
  remove: 6,
  move: 7,
  usage: 8,
} as const;

const KIND_CODES: Readonly<Record<FilesystemEntryKind, number>> = {
  file: 1,
  directory: 2,
  other: 3,
};

export function detailsBytes(entry: Omit<FilesystemEntry, 'name'>): Buffer {
  const bytes = Buffer.alloc(DETAILS_BYTES);
  bytes.writeUInt8(KIND_CODES[entry.kind]);
  bytes.writeBigUInt64BE(BigInt(entry.sizeBytes), SIZE_OFFSET);
  bytes.writeBigInt64BE(BigInt(Date.parse(entry.modifiedAt) / MS_PER_SECOND), MODIFIED_OFFSET);
  return bytes;
}

export function entryBytes(entry: FilesystemEntry): Buffer {
  const name = Buffer.from(entry.name, 'utf8');
  return Buffer.concat([detailsBytes(entry), Buffer.of(name.byteLength), name]);
}

export function listingBody({
  entries,
  truncated = false,
}: {
  entries: readonly FilesystemEntry[];
  truncated?: boolean;
}): Buffer {
  return Buffer.concat([Buffer.of(truncated ? 1 : 0), ...entries.map(entryBytes)]);
}

const UINT64_BYTES = 8;

/** Two big-endian counts and nothing else, which is the whole of what `usage` answers with. */
export function usageBody({
  totalBytes,
  usedBytes,
}: {
  totalBytes: number;
  usedBytes: number;
}): Buffer {
  const bytes = Buffer.alloc(UINT64_BYTES * 2);
  bytes.writeBigUInt64BE(BigInt(totalBytes));
  bytes.writeBigUInt64BE(BigInt(usedBytes), UINT64_BYTES);
  return bytes;
}

export function replyFrame({
  status,
  body = Buffer.alloc(0),
}: {
  status: number;
  body?: Buffer;
}): Buffer {
  const header = Buffer.alloc(HEADER_BYTES);
  FRAME_MAGIC.copy(header);
  header.writeUInt8(status, CODE_OFFSET);
  header.writeUInt32BE(body.byteLength, LENGTH_OFFSET);
  return Buffer.concat([header, body]);
}

export type ReceivedRequest = { readonly verb: number; readonly body: Buffer };

/** Frames survive arbitrary chunking, so `rest` carries a partial one forward. */
export function requestsIn(buffered: Buffer): {
  readonly requests: readonly ReceivedRequest[];
  readonly rest: Buffer;
} {
  const requests: ReceivedRequest[] = [];
  let rest = buffered;
  while (rest.byteLength >= HEADER_BYTES) {
    const bodyLength = rest.readUInt32BE(LENGTH_OFFSET);
    if (rest.byteLength < HEADER_BYTES + bodyLength) {
      break;
    }
    requests.push({
      verb: rest.readUInt8(CODE_OFFSET),
      body: rest.subarray(HEADER_BYTES, HEADER_BYTES + bodyLength),
    });
    rest = rest.subarray(HEADER_BYTES + bodyLength);
  }
  return { requests, rest };
}

/** The first length-prefixed field of a request body, which for every verb is the path. */
export function pathIn(body: Buffer): string {
  const length = body.readUInt32BE(0);
  return body.subarray(UINT32_BYTES, UINT32_BYTES + length).toString();
}
