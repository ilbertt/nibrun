import { Buffer } from 'node:buffer';
import {
  type AppId,
  DIRECTORY_ENTRY_LIMIT,
  type DirectoryListing,
  type FilesystemEntry,
  type FilesystemEntryKind,
  type FilesystemUsage,
  GUEST_PATH_ROOT,
  type GuestPath,
  isValidMessage,
  type Timestamp,
  TimestampSchema,
  Value,
} from '@repo/protocol';
import { Data, Either } from 'effect';
import { MKFS_ROOT_ENTRIES } from '#lib/volumes/ext4.ts';

/**
 * The bytes the guest's filesystem process speaks. `apps/runtime/src/guest-filesystem.h` states
 * the format; this is the half that encodes and decodes it.
 *
 * Nothing here is text. A path goes out behind its own length and a name comes back behind one,
 * because the tenant's binary created these names and ext4 allows anything in them but `/` and
 * NUL — a space, a quote, a newline, a leading dash. The reader this replaced had to hand its
 * path to a tokeniser that would have read a quote as the end of one, which is why a directory
 * named `it's` could be listed and never opened. Length prefixes are what make that restriction
 * unnecessary rather than merely relaxed.
 */

const UINT32_BYTES = 4;
const UINT64_BYTES = 8;

const EMPTY_BODY = Buffer.alloc(0);

const FRAME_MAGIC = Buffer.from('NBF1');
const CODE_OFFSET = FRAME_MAGIC.byteLength;
const LENGTH_OFFSET = CODE_OFFSET + 1;
export const FRAME_HEADER_BYTES = LENGTH_OFFSET + UINT32_BYTES;

/** What one frame's body may hold, which is the guest's ceiling and the reason it never allocates. */
const BODY_MAX_BYTES = 65_536;

/**
 * A chunk a caller can read or write without having to work out how much room its own path left.
 * `fitsOneRequest` is what actually decides; this is the size that always does.
 */
export const GUEST_FILESYSTEM_CHUNK_BYTES = 32_768;

const VERBS = {
  list: 1,
  stat: 2,
  read: 3,
  write: 4,
  makeDirectory: 5,
  remove: 6,
  move: 7,
  usage: 8,
  compute: 9,
} as const;

const STATUS_OK = 0;

/**
 * Read as a sentence rather than as a code, because this is the half of a failure that reaches
 * whoever asked. None of them names the path: what a tenant keeps in their own filesystem is
 * theirs to know and not an operator's.
 */
const REFUSALS: Readonly<Record<number, string>> = {
  1: 'there is nothing at that path',
  2: 'what is there is not the kind of thing that asks for',
  3: 'something is there already',
  4: 'the directory still holds something',
  5: 'that path leads out of the volume',
  6: 'the guest could not read the request',
  7: 'the guest could not carry it out',
};

const TRUNCATE = 1;
const NO_FLAGS = 0;

export class GuestFilesystemRefused extends Data.TaggedError('GuestFilesystemRefused')<{
  readonly appId: AppId;
  readonly status: number;
}> {
  override get message() {
    const refusal = REFUSALS[this.status] ?? 'it gave no reason this host understands';
    return `the guest running ${this.appId} would not do that with its files: ${refusal}`;
  }
}

export class MalformedGuestReply extends Data.TaggedError('MalformedGuestReply')<{
  readonly reason: string;
}> {
  override get message() {
    return `the guest answered about its files with bytes this host cannot read: ${this.reason}`;
  }
}

export class GuestRequestTooLarge extends Data.TaggedError('GuestRequestTooLarge')<{
  readonly appId: AppId;
}> {
  override get message() {
    return `more was asked of the guest running ${this.appId} at once than one request carries`;
  }
}

export type GuestFilesystemRequest =
  | { readonly verb: 'list'; readonly path: GuestPath }
  | { readonly verb: 'stat'; readonly path: GuestPath }
  | {
      readonly verb: 'read';
      readonly path: GuestPath;
      readonly offset: number;
      readonly length: number;
    }
  | {
      readonly verb: 'write';
      readonly path: GuestPath;
      readonly offset: number;
      readonly content: Uint8Array;
      readonly truncate: boolean;
    }
  | { readonly verb: 'makeDirectory'; readonly path: GuestPath }
  | { readonly verb: 'remove'; readonly path: GuestPath }
  | { readonly verb: 'move'; readonly path: GuestPath; readonly destination: GuestPath }
  | { readonly verb: 'usage' }
  | { readonly verb: 'compute' };

function field(value: string | Uint8Array): Buffer {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
  const length = Buffer.alloc(UINT32_BYTES);
  length.writeUInt32BE(bytes.byteLength);
  return Buffer.concat([length, bytes]);
}

function offsetOf(value: number): Buffer {
  const encoded = Buffer.alloc(UINT64_BYTES);
  encoded.writeBigUInt64BE(BigInt(value));
  return encoded;
}

function lengthOf(value: number): Buffer {
  const encoded = Buffer.alloc(UINT32_BYTES);
  encoded.writeUInt32BE(value);
  return encoded;
}

function bodyOf(request: GuestFilesystemRequest): Buffer {
  // The verbs that name no path, because what they answer about is the guest rather than a place
  // in the tenant's filesystem: a volume is one filesystem all the way down, and what the machine
  // is spending is not about a file at all.
  if (request.verb === 'usage' || request.verb === 'compute') {
    return EMPTY_BODY;
  }
  const path = field(request.path);
  switch (request.verb) {
    case 'read':
      return Buffer.concat([path, offsetOf(request.offset), lengthOf(request.length)]);
    case 'write':
      return Buffer.concat([
        path,
        offsetOf(request.offset),
        Buffer.of(request.truncate ? TRUNCATE : NO_FLAGS),
        field(request.content),
      ]);
    case 'move':
      return Buffer.concat([path, field(request.destination)]);
    default:
      return path;
  }
}

export function encodeRequest(request: GuestFilesystemRequest): Buffer {
  const body = bodyOf(request);
  const header = Buffer.alloc(FRAME_HEADER_BYTES);
  FRAME_MAGIC.copy(header);
  header.writeUInt8(VERBS[request.verb], CODE_OFFSET);
  header.writeUInt32BE(body.byteLength, LENGTH_OFFSET);
  return Buffer.concat([header, body]);
}

/** Asked before sending rather than discovered afterwards: the guest answers an oversized frame
 * by hanging up, which would cost the connection as well as the request. */
export function fitsOneRequest(request: GuestFilesystemRequest): boolean {
  return bodyOf(request).byteLength <= BODY_MAX_BYTES;
}

export type ReplyHeader = { readonly status: number; readonly bodyLength: number };

export function decodeHeader(header: Buffer): Either.Either<ReplyHeader, MalformedGuestReply> {
  if (header.byteLength !== FRAME_HEADER_BYTES) {
    return Either.left(new MalformedGuestReply({ reason: 'the header is the wrong length' }));
  }
  if (!header.subarray(0, FRAME_MAGIC.byteLength).equals(FRAME_MAGIC)) {
    return Either.left(new MalformedGuestReply({ reason: 'invalid magic value' }));
  }
  const bodyLength = header.readUInt32BE(LENGTH_OFFSET);
  if (bodyLength > BODY_MAX_BYTES) {
    return Either.left(new MalformedGuestReply({ reason: 'the body exceeds the limit' }));
  }
  return Either.right({ status: header.readUInt8(CODE_OFFSET), bodyLength });
}

export const isRefusal = (status: number): boolean => status !== STATUS_OK;

const KINDS: Readonly<Record<number, FilesystemEntryKind>> = { 1: 'file', 2: 'directory' };

/** One kind byte, an unsigned size, then a signed instant in seconds. */
const KIND_OFFSET = 0;
const SIZE_OFFSET = KIND_OFFSET + 1;
const MODIFIED_OFFSET = SIZE_OFFSET + UINT64_BYTES;
const DETAILS_BYTES = MODIFIED_OFFSET + UINT64_BYTES;
const MS_PER_SECOND = 1000;
/** Through the seconds and no further, because seconds are all a filesystem stamps a file with. */
const SECONDS_PRECISION_LENGTH = 19;

const EPOCH: Timestamp = Value.Parse(TimestampSchema, '1970-01-01T00:00:00Z');

/**
 * ext4 dates every file it holds, but nothing stops the bytes describing one being nonsense, and
 * a name is worth more to whoever is looking than a date nobody set. So an instant that cannot be
 * written down costs its own field rather than the entry carrying it.
 */
function timestampFrom(seconds: bigint): Timestamp {
  const instant = new Date(Number(seconds) * MS_PER_SECOND);
  const rendered = Number.isNaN(instant.getTime())
    ? ''
    : `${instant.toISOString().slice(0, SECONDS_PRECISION_LENGTH)}Z`;
  return isValidMessage({ schema: TimestampSchema, value: rendered })
    ? Value.Parse(TimestampSchema, rendered)
    : EPOCH;
}

/**
 * Everything a listing says about one entry except its name — which is what `stat` answers,
 * because whoever asked already named what they asked about.
 */
export type FilesystemDetails = Omit<FilesystemEntry, 'name'>;

function detailsAt({ body, offset }: { body: Buffer; offset: number }): FilesystemDetails {
  return {
    kind: KINDS[body.readUInt8(offset + KIND_OFFSET)] ?? 'other',
    sizeBytes: Number(body.readBigUInt64BE(offset + SIZE_OFFSET)),
    modifiedAt: timestampFrom(body.readBigInt64BE(offset + MODIFIED_OFFSET)),
  };
}

export function decodeDetails(body: Buffer): Either.Either<FilesystemDetails, MalformedGuestReply> {
  return body.byteLength < DETAILS_BYTES
    ? Either.left(new MalformedGuestReply({ reason: 'the details are the wrong length' }))
    : Either.right(detailsAt({ body, offset: 0 }));
}

export function decodeWritten(body: Buffer): Either.Either<number, MalformedGuestReply> {
  return body.byteLength < UINT32_BYTES
    ? Either.left(new MalformedGuestReply({ reason: 'no count came back from a write' }))
    : Either.right(body.readUInt32BE(0));
}

const TOTAL_OFFSET = 0;
const USED_OFFSET = TOTAL_OFFSET + UINT64_BYTES;
const USAGE_BYTES = USED_OFFSET + UINT64_BYTES;

/** What the guest measured, without the moment it was measured — which is this end's to stamp. */
export type MeasuredBytes = Omit<FilesystemUsage, 'measuredAt'>;

export function decodeUsage(body: Buffer): Either.Either<MeasuredBytes, MalformedGuestReply> {
  return body.byteLength < USAGE_BYTES
    ? Either.left(new MalformedGuestReply({ reason: 'the usage is the wrong length' }))
    : Either.right({
        totalBytes: Number(body.readBigUInt64BE(TOTAL_OFFSET)),
        usedBytes: Number(body.readBigUInt64BE(USED_OFFSET)),
      });
}

const MEMORY_TOTAL_OFFSET = 0;
const MEMORY_USED_OFFSET = MEMORY_TOTAL_OFFSET + UINT64_BYTES;
const CPU_TOTAL_OFFSET = MEMORY_USED_OFFSET + UINT64_BYTES;
const CPU_BUSY_OFFSET = CPU_TOTAL_OFFSET + UINT64_BYTES;
const COMPUTE_BYTES = CPU_BUSY_OFFSET + UINT64_BYTES;

/**
 * What one reading of the guest holds, before anything has turned the ticks into a rate.
 *
 * The ticks are cumulative since the guest booted and mean nothing on their own — a share is the
 * difference between two of these over the time between them, which is why the counters are kept
 * rather than reported. They reset when the microVM does, which is the one thing whoever divides
 * them has to check for.
 */
export type MeasuredCompute = {
  readonly memoryTotalBytes: number;
  readonly memoryUsedBytes: number;
  readonly cpuTotalTicks: number;
  readonly cpuBusyTicks: number;
};

export function decodeCompute(body: Buffer): Either.Either<MeasuredCompute, MalformedGuestReply> {
  return body.byteLength < COMPUTE_BYTES
    ? Either.left(new MalformedGuestReply({ reason: 'the compute reading is the wrong length' }))
    : Either.right({
        memoryTotalBytes: Number(body.readBigUInt64BE(MEMORY_TOTAL_OFFSET)),
        memoryUsedBytes: Number(body.readBigUInt64BE(MEMORY_USED_OFFSET)),
        cpuTotalTicks: Number(body.readBigUInt64BE(CPU_TOTAL_OFFSET)),
        cpuBusyTicks: Number(body.readBigUInt64BE(CPU_BUSY_OFFSET)),
      });
}

const TRUNCATED_OFFSET = 0;
const FIRST_ENTRY_OFFSET = TRUNCATED_OFFSET + 1;
const NAME_LENGTH_OFFSET = DETAILS_BYTES;

/**
 * `.` and `..` never arrive: the guest leaves out the filesystem's own bookkeeping, because
 * navigating upwards belongs to whoever is browsing. What is left out here instead is what
 * `mkfs.ext4` put at the root of the volume, because that is the host's knowledge and not the
 * guest's — and only at the root, since the same name one directory down is a directory a tenant
 * made, and hiding it would be hiding their own data from them.
 *
 * `truncated` can come from either side. The guest sets it when a directory outgrew one frame;
 * this sets it when it outgrew what the wire onwards carries.
 */
export function decodeListing({
  body,
  path,
}: {
  body: Buffer;
  path: GuestPath;
}): Either.Either<DirectoryListing, MalformedGuestReply> {
  if (body.byteLength < FIRST_ENTRY_OFFSET) {
    return Either.left(
      new MalformedGuestReply({ reason: 'a listing came back with nothing in it' }),
    );
  }
  const entries: FilesystemEntry[] = [];
  const atRoot = path === GUEST_PATH_ROOT;
  let truncated = body.readUInt8(TRUNCATED_OFFSET) !== 0;
  let offset = FIRST_ENTRY_OFFSET;

  while (offset < body.byteLength) {
    const nameLengthAt = offset + NAME_LENGTH_OFFSET;
    if (nameLengthAt >= body.byteLength) {
      return Either.left(new MalformedGuestReply({ reason: 'an entry was cut short' }));
    }
    const nameLength = body.readUInt8(nameLengthAt);
    const nameAt = nameLengthAt + 1;
    if (nameLength === 0 || nameAt + nameLength > body.byteLength) {
      return Either.left(new MalformedGuestReply({ reason: 'an entry names nothing readable' }));
    }
    const name = body.subarray(nameAt, nameAt + nameLength).toString();
    if (entries.length === DIRECTORY_ENTRY_LIMIT) {
      truncated = true;
      break;
    }
    if (!(atRoot && MKFS_ROOT_ENTRIES.has(name))) {
      entries.push({ name, ...detailsAt({ body, offset }) });
    }
    offset = nameAt + nameLength;
  }

  return Either.right({ path, entries, truncated });
}
