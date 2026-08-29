import { describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import {
  AppIdSchema,
  DIRECTORY_ENTRY_LIMIT,
  type FilesystemEntry,
  type GuestPath,
  GuestPathSchema,
  type Timestamp,
  TimestampSchema,
  Value,
} from '@repo/protocol';
import { Either } from 'effect';
import {
  decodeCompute,
  decodeDetails,
  decodeHeader,
  decodeListing,
  decodeUsage,
  decodeWritten,
  encodeRequest,
  FRAME_HEADER_BYTES,
  fitsOneRequest,
  GUEST_FILESYSTEM_CHUNK_BYTES,
  GuestFilesystemRefused,
  isRefusal,
} from '#lib/filesystem/protocol.ts';
import {
  computeBody,
  detailsBytes,
  entryBytes,
  GUEST_STATUS,
  GUEST_VERB,
  listingBody,
  pathIn,
  replyFrame,
  requestsIn,
  usageBody,
} from '#tests/support/guest-filesystem.ts';

const ROOT = Value.Parse(GuestPathSchema, '/');
const APP = Value.Parse(AppIdSchema, 'app-pocketbase');
const AT = (value: string): Timestamp => Value.Parse(TimestampSchema, value);
const MODIFIED = AT('2026-01-15T10:24:00Z');
const SOME_SIZE = 32_768;
const UINT32_BYTES = 4;
const EVERY_BIT = 0xff_ff_ff_ff;
const MODIFIED_AT_OFFSET = 9;
/** A NUL, a newline, a quote, a high byte and a backslash: none of it text, all of it a file. */
const BINARY = Buffer.from('00610aff22007f5c', 'hex');

function entry(name: string): FilesystemEntry {
  return { name, kind: 'file', sizeBytes: SOME_SIZE, modifiedAt: MODIFIED };
}

function listingOf({
  entries,
  truncated = false,
  path = ROOT,
}: {
  entries: readonly FilesystemEntry[];
  truncated?: boolean;
  path?: GuestPath;
}) {
  const decoded = decodeListing({ body: listingBody({ entries, truncated }), path });
  if (Either.isLeft(decoded)) {
    throw new Error(`expected a listing: ${decoded.left.message}`);
  }
  return decoded.right;
}

/**
 * The whole reason the wire is bytes rather than a command string. The reader this replaced had to
 * hand its path to a tokeniser, so a directory named `it's` could be listed and never opened; here
 * the name is behind its own length and nothing parses it.
 */
describe('a name is whatever the tenant made it, in both directions', () => {
  test('every name ext4 allows survives a listing', () => {
    const awkward = ['my report v2.txt', 'it\'s "quoted"', 'two\nlines', '-rf', 'données.txt'];

    expect(listingOf({ entries: awkward.map(entry) }).entries.map((found) => found.name)).toEqual(
      awkward,
    );
  });

  // `GuestPathSchema` still refuses a quote, and this is why that restriction no longer has a
  // cause: the value is a length-prefixed field, so nothing between here and the guest reads it.
  // Relaxing the schema is a change for whoever owns it; being ready for it is this.
  test('and every path ext4 allows goes out untouched', () => {
    const awkward = '/it\'s "quoted"/two\nlines/-rf' as GuestPath;
    const { requests } = requestsIn(encodeRequest({ verb: 'list', path: awkward }));

    expect(requests).toHaveLength(1);
    expect(requests[0] && pathIn(requests[0].body)).toBe(awkward);
  });
});

describe('a request carries what its verb needs and nothing else', () => {
  test('each verb goes out under its own code', () => {
    const verbs = [
      { request: { verb: 'list', path: ROOT }, code: GUEST_VERB.list },
      { request: { verb: 'stat', path: ROOT }, code: GUEST_VERB.stat },
      { request: { verb: 'makeDirectory', path: ROOT }, code: GUEST_VERB.makeDirectory },
      { request: { verb: 'remove', path: ROOT }, code: GUEST_VERB.remove },
      { request: { verb: 'move', path: ROOT, destination: ROOT }, code: GUEST_VERB.move },
      { request: { verb: 'usage' }, code: GUEST_VERB.usage },
      { request: { verb: 'compute' }, code: GUEST_VERB.compute },
    ] as const;

    for (const { request, code } of verbs) {
      expect(requestsIn(encodeRequest(request)).requests[0]?.verb).toBe(code);
    }
  });

  // A chunk the guest would refuse to frame is one this side must not spend a connection on: the
  // guest answers an oversized frame by hanging up.
  test('a chunk larger than one frame is known to be too large before it is sent', () => {
    const content = new Uint8Array(GUEST_FILESYSTEM_CHUNK_BYTES);

    expect(fitsOneRequest({ verb: 'write', path: ROOT, offset: 0, content, truncate: true })).toBe(
      true,
    );
    expect(
      fitsOneRequest({
        verb: 'write',
        path: ROOT,
        offset: 0,
        content: new Uint8Array(GUEST_FILESYSTEM_CHUNK_BYTES * 2),
        truncate: true,
      }),
    ).toBe(false);
  });

  // A volume is one filesystem, so the question has no place in it to be about — and a path the
  // guest was told to ignore is a path one field away from being read.
  test('asking how full a volume is names nothing', () => {
    expect(requestsIn(encodeRequest({ verb: 'usage' })).requests[0]?.body.byteLength).toBe(0);
  });

  test('asking what a guest is spending names nothing either', () => {
    expect(requestsIn(encodeRequest({ verb: 'compute' })).requests[0]?.body.byteLength).toBe(0);
  });

  test('content crosses byte for byte, NULs and all', () => {
    const content = new Uint8Array(BINARY);
    const { requests } = requestsIn(
      encodeRequest({ verb: 'write', path: ROOT, offset: 0, content, truncate: false }),
    );
    const body = requests[0]?.body ?? Buffer.alloc(0);

    expect(body.subarray(body.byteLength - content.byteLength)).toEqual(Buffer.from(content));
  });
});

describe('what mkfs left at the root is not the tenant data', () => {
  const withLostAndFound = [entry('lost+found'), entry('pb_data')];

  test('it is left out of the root', () => {
    expect(listingOf({ entries: withLostAndFound }).entries.map((found) => found.name)).toEqual([
      'pb_data',
    ]);
  });

  // The name is reserved in one directory only. Anywhere else it is a directory the tenant made,
  // and hiding it would be hiding their own data from them.
  test('but the same name below the root is the tenant own directory', () => {
    const listing = listingOf({
      entries: withLostAndFound,
      path: Value.Parse(GuestPathSchema, '/pb_data'),
    });

    expect(listing.entries.map((found) => found.name)).toEqual(['lost+found', 'pb_data']);
  });
});

describe('a listing that did not fit says so', () => {
  test('the guest saying it ran out of frame carries through', () => {
    expect(listingOf({ entries: [entry('one')], truncated: true }).truncated).toBe(true);
  });

  test('and so does outgrowing what the wire onwards carries', () => {
    const many = Array.from(Array(DIRECTORY_ENTRY_LIMIT + 1).keys()).map((index) =>
      entry(`file-${index}`),
    );
    const listing = listingOf({ entries: many });

    expect(listing.entries).toHaveLength(DIRECTORY_ENTRY_LIMIT);
    expect(listing.truncated).toBe(true);
  });
});

// The guest is the only thing that writes these, so reaching any of them means the bytes on the
// socket were not the guest's — which is exactly when trusting them would be the bug.
describe('bytes that are not an answer are refused rather than read', () => {
  test('a header with the wrong magic is not a frame', () => {
    const wrong = replyFrame({ status: GUEST_STATUS.ok });
    wrong.write('XXXX', 0);

    expect(Either.isLeft(decodeHeader(wrong.subarray(0, FRAME_HEADER_BYTES)))).toBe(true);
  });

  test('a body larger than one frame is not one either', () => {
    const header = replyFrame({ status: GUEST_STATUS.ok }).subarray(0, FRAME_HEADER_BYTES);
    header.writeUInt32BE(EVERY_BIT, FRAME_HEADER_BYTES - UINT32_BYTES);

    expect(Either.isLeft(decodeHeader(header))).toBe(true);
  });

  test('an entry cut short costs the listing rather than being guessed at', () => {
    const whole = listingBody({ entries: [entry('pb_data')] });

    expect(
      Either.isLeft(decodeListing({ body: whole.subarray(0, whole.byteLength - 2), path: ROOT })),
    ).toBe(true);
    expect(Either.isLeft(decodeListing({ body: Buffer.alloc(0), path: ROOT }))).toBe(true);
  });

  test('details and counts have to be the length they claim', () => {
    expect(Either.isLeft(decodeDetails(Buffer.alloc(1)))).toBe(true);
    expect(Either.isLeft(decodeWritten(Buffer.alloc(1)))).toBe(true);
  });
});

describe('what the guest describes', () => {
  test('a kind it names and a size and an instant it read', () => {
    const details = decodeDetails(
      detailsBytes({ kind: 'directory', sizeBytes: 4096, modifiedAt: MODIFIED }),
    );

    expect(Either.isRight(details) && details.right).toEqual({
      kind: 'directory',
      sizeBytes: 4096,
      modifiedAt: MODIFIED,
    });
  });

  // Everything that is not a regular file or a directory answers the same question the same way,
  // so a symlink is shown, is not descendable, and never names what it points at.
  test('a symlink is neither a file nor a way out of the volume', () => {
    const [link] = listingOf({
      entries: [{ name: 'latest.db', kind: 'other', sizeBytes: 11, modifiedAt: MODIFIED }],
    }).entries;

    expect(link?.kind).toBe('other');
    expect(JSON.stringify(link)).not.toInclude('->');
  });

  // A date nobody set is worth less to whoever is looking than the name beside it.
  test('an instant that cannot be written down costs its own field and no other', () => {
    const nonsense = entryBytes(entry('data.db'));
    nonsense.writeBigInt64BE(BigInt(Number.MAX_SAFE_INTEGER), MODIFIED_AT_OFFSET);
    const decoded = decodeListing({ body: Buffer.concat([Buffer.of(0), nonsense]), path: ROOT });

    expect(Either.isRight(decoded) && decoded.right.entries[0]?.name).toBe('data.db');
  });
});

describe('how full a volume is comes back as two counts', () => {
  const MEASURED = { totalBytes: 8_455_712_768, usedBytes: 1_503_238_553 };

  test('both survive the wire at sizes a 32-bit count could not hold', () => {
    expect(decodeUsage(usageBody(MEASURED))).toEqual(Either.right(MEASURED));
  });

  test('a body too short to hold them is refused rather than read as zero', () => {
    const short = usageBody(MEASURED).subarray(0, 1);

    expect(Either.isLeft(decodeUsage(short))).toBe(true);
  });
});

describe('what a guest is spending comes back as four counters', () => {
  const MEASURED = {
    memoryTotalBytes: 1_031_012_352,
    memoryUsedBytes: 412_401_664,
    cpuTotalTicks: 5_998_412,
    cpuBusyTicks: 1_071_233,
  };

  test('all four survive the wire in the order the guest writes them', () => {
    expect(decodeCompute(computeBody(MEASURED))).toEqual(Either.right(MEASURED));
  });

  // A guest whose image predates the verb refuses it outright, which is a status and not a short
  // body. A short body is a guest speaking something else, and reading the part that fits would
  // report a machine spending nothing.
  test('a body too short to hold them is refused rather than read as zero', () => {
    const short = computeBody(MEASURED).subarray(0, 1);

    expect(Either.isLeft(decodeCompute(short))).toBe(true);
  });
});

describe('a refusal reaches whoever asked as a sentence', () => {
  test('every status the guest can answer with is a refusal but ok', () => {
    expect(isRefusal(GUEST_STATUS.ok)).toBe(false);
    expect(isRefusal(GUEST_STATUS.denied)).toBe(true);
  });

  // It names the app because an operator needs to know which one, and never the path, which is
  // the tenant's to know.
  test('and names the app rather than what was asked about', () => {
    const refused = new GuestFilesystemRefused({ appId: APP, status: GUEST_STATUS.denied });

    expect(refused.message).toContain(APP);
    expect(refused.message).toContain('out of the volume');
  });

  test('including one this host has no name for', () => {
    const unknown = new GuestFilesystemRefused({ appId: APP, status: GUEST_STATUS.failed + 1 });

    expect(unknown.message.length).toBeGreaterThan(unknown._tag.length);
  });
});
