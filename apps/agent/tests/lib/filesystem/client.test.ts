import { describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type AppId,
  AppIdSchema,
  type FilesystemEntry,
  GuestPathSchema,
  type Timestamp,
  TimestampSchema,
  Value,
} from '@repo/protocol';
import { Effect } from 'effect';
import { type GuestFilesystem, guestFilesystem } from '#lib/filesystem/client.ts';
import { GUEST_FILESYSTEM_CHUNK_BYTES } from '#lib/filesystem/protocol.ts';
import { GUEST_VSOCK_FILENAME } from '#lib/vm/vsock.ts';
import {
  detailsBytes,
  GUEST_STATUS,
  GUEST_VERB,
  listingBody,
  pathIn,
  type ReceivedRequest,
  replyFrame,
  requestsIn,
} from '#tests/support/guest-filesystem.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const APP_ID: AppId = Value.Parse(AppIdSchema, 'pocketbase-8zv0ch');
const ROOT = Value.Parse(GuestPathSchema, '/');
const DATA = Value.Parse(GuestPathSchema, '/pb_data');
const MODIFIED: Timestamp = Value.Parse(TimestampSchema, '2026-02-04T09:05:00Z');
const SOME_SIZE = 4096;
const COUNT_BYTES = 4;
const FRAMES_THAT_DO_NOT_FIT = 4;
const CUT_SHORT_BY = 4;

const run = provided(platform);

type GuestScript = {
  readonly onConnect?: string;
  readonly replies?: readonly Buffer[];
  readonly hangUpAfterReplies?: boolean;
};

/**
 * Firecracker's end of the vsock device, which is a plain unix socket speaking a text handshake
 * before the stream becomes the guest's — and behind it a guest that answers in bytes written out
 * here rather than produced by the code under test. What the real guest does with a request is
 * `apps/runtime`'s to prove; what this covers is the half that frames one and reads the answer.
 */
function fakeGuest({ vmDir, script }: { vmDir: string; script: GuestScript }) {
  const received: ReceivedRequest[] = [];
  return Effect.map(
    Effect.acquireRelease(
      Effect.promise(async () => {
        const workingDir = join(vmDir, APP_ID);
        await mkdir(workingDir, { recursive: true });
        const { onConnect = 'OK 1024\n', replies = [], hangUpAfterReplies = false } = script;
        const pending = [...replies];
        let buffered: Buffer = Buffer.alloc(0);
        return Bun.listen({
          unix: join(workingDir, GUEST_VSOCK_FILENAME),
          socket: {
            // biome-ignore lint/complexity/useMaxParams: Bun hands a socket handler its own socket
            data: (socket, chunk) => {
              if (
                buffered.byteLength === 0 &&
                chunk.subarray(0, 'CONNECT'.length).toString() === 'CONNECT'
              ) {
                socket.write(onConnect);
                return;
              }
              const read = requestsIn(Buffer.concat([buffered, chunk]));
              buffered = read.rest;
              for (const request of read.requests) {
                received.push(request);
                const reply = pending.shift();
                if (reply === undefined) {
                  socket.end();
                  return;
                }
                socket.write(reply);
                if (pending.length === 0 && hangUpAfterReplies) {
                  socket.end();
                }
              }
            },
          },
        });
      }),
      (server) => Effect.sync(() => server.stop(true)),
    ),
    () => ({ received }),
  );
}

/** What a caller does with the client, and the tag of whatever stopped it doing so. */
function against<A>({
  script,
  ask,
}: {
  script: GuestScript;
  ask: (guest: GuestFilesystem) => Effect.Effect<A, { readonly _tag: string }>;
}) {
  return run(
    Effect.gen(function* () {
      const vmDir = yield* temporaryDirectory;
      const guest = yield* fakeGuest({ vmDir, script });
      const outcome = yield* Effect.scoped(
        Effect.flatMap(guestFilesystem({ appId: APP_ID, vmDir }), ask),
      ).pipe(Effect.catchAll((error) => Effect.succeed(error._tag)));
      return { outcome, received: guest.received };
    }),
  );
}

function entry(name: string): FilesystemEntry {
  return { name, kind: 'file', sizeBytes: SOME_SIZE, modifiedAt: MODIFIED };
}

const AWKWARD = ['my report v2.txt', 'it\'s "quoted"', 'two\nlines', '-rf'];

describe('a directory read from inside the guest', () => {
  test('comes back with every name the tenant gave it', async () => {
    const { outcome } = await against({
      script: {
        replies: [
          replyFrame({
            status: GUEST_STATUS.ok,
            body: listingBody({ entries: AWKWARD.map(entry) }),
          }),
        ],
      },
      ask: (guest) => guest.list(DATA),
    });

    expect(outcome).toEqual({
      path: DATA,
      entries: AWKWARD.map(entry),
      truncated: false,
    });
  });

  test('and asks for exactly the path it was given', async () => {
    const { received } = await against({
      script: {
        replies: [replyFrame({ status: GUEST_STATUS.ok, body: listingBody({ entries: [] }) })],
      },
      ask: (guest) => guest.list(DATA),
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.verb).toBe(GUEST_VERB.list);
    expect(received[0] && pathIn(received[0].body)).toBe(DATA);
  });

  // A directory a tenant emptied and one that cannot be read are different answers now, because
  // the guest says which. The reader this replaced could only tell them apart by whether `.` came
  // back in the output.
  test('an empty directory is empty rather than a failed read', async () => {
    const { outcome } = await against({
      script: {
        replies: [replyFrame({ status: GUEST_STATUS.ok, body: listingBody({ entries: [] }) })],
      },
      ask: (guest) => guest.list(ROOT),
    });

    expect(outcome).toEqual({ path: ROOT, entries: [], truncated: false });
  });

  test('and a path the guest would not resolve is a refusal that says so', async () => {
    const { outcome } = await against({
      script: { replies: [replyFrame({ status: GUEST_STATUS.denied })] },
      ask: (guest) => guest.list(DATA),
    });

    expect(outcome).toBe('GuestFilesystemRefused');
  });
});

/** A NUL, a newline, a quote, a high byte and a backslash: none of it text, all of it a file. */
const BINARY = new Uint8Array(Buffer.from('00610aff22007f5c', 'hex'));

describe('a file crosses byte for byte in both directions', () => {
  test('what is read is what the guest sent', async () => {
    const { outcome } = await against({
      script: {
        replies: [replyFrame({ status: GUEST_STATUS.ok, body: Buffer.from(BINARY) })],
      },
      ask: (guest) => guest.read({ path: DATA, offset: 0, length: BINARY.byteLength }),
    });

    expect(outcome).toEqual(Buffer.from(BINARY));
  });

  test('what is written is what the guest receives, and it says how much landed', async () => {
    const written = Buffer.alloc(COUNT_BYTES);
    written.writeUInt32BE(BINARY.byteLength);
    const { outcome, received } = await against({
      script: { replies: [replyFrame({ status: GUEST_STATUS.ok, body: written })] },
      ask: (guest) => guest.write({ path: DATA, offset: 0, content: BINARY, truncate: true }),
    });

    expect(outcome).toBe(BINARY.byteLength);
    expect(received[0]?.verb).toBe(GUEST_VERB.write);
    const body = received[0]?.body ?? Buffer.alloc(0);
    expect(body.subarray(body.byteLength - BINARY.byteLength)).toEqual(Buffer.from(BINARY));
  });

  // Asked before it is sent, because the guest answers an oversized frame by hanging up — which
  // would cost the connection as well as the request.
  test('more than one frame carries is refused without spending the connection', async () => {
    const { outcome, received } = await against({
      script: {},
      ask: (guest) =>
        guest.write({
          path: DATA,
          offset: 0,
          content: new Uint8Array(GUEST_FILESYSTEM_CHUNK_BYTES * FRAMES_THAT_DO_NOT_FIT),
          truncate: false,
        }),
    });

    expect(outcome).toBe('GuestRequestTooLarge');
    expect(received).toHaveLength(0);
  });
});

describe('the verbs nothing calls yet still speak', () => {
  const nothing = replyFrame({ status: GUEST_STATUS.ok });

  test('a directory is made, an entry is removed, and one is moved', async () => {
    const { received } = await against({
      script: { replies: [nothing, nothing, nothing] },
      ask: (guest) =>
        Effect.all([
          guest.makeDirectory(DATA),
          guest.remove(DATA),
          guest.move({ path: DATA, destination: ROOT }),
        ]),
    });

    expect(received.map((request) => request.verb)).toEqual([
      GUEST_VERB.makeDirectory,
      GUEST_VERB.remove,
      GUEST_VERB.move,
    ]);
  });

  test('and one entry is described on its own', async () => {
    const { outcome } = await against({
      script: {
        replies: [
          replyFrame({
            status: GUEST_STATUS.ok,
            body: detailsBytes({ kind: 'directory', sizeBytes: SOME_SIZE, modifiedAt: MODIFIED }),
          }),
        ],
      },
      ask: (guest) => guest.stat(DATA),
    });

    expect(outcome).toEqual({ kind: 'directory', sizeBytes: SOME_SIZE, modifiedAt: MODIFIED });
  });

  // One connection, as many requests as the caller makes: an upload is many chunks and paying for
  // a handshake per chunk would be paying for it once per kilobyte.
  test('every request goes over the one connection', async () => {
    const { received } = await against({
      script: { replies: [nothing, nothing] },
      ask: (guest) => Effect.all([guest.remove(DATA), guest.remove(ROOT)]),
    });

    expect(received).toHaveLength(2);
  });
});

describe('a guest that does not answer is not a directory that is empty', () => {
  test('no VMM at all is said plainly', async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const vmDir = yield* temporaryDirectory;
        return yield* Effect.scoped(
          Effect.flatMap(guestFilesystem({ appId: APP_ID, vmDir }), (guest) => guest.list(ROOT)),
        ).pipe(Effect.catchAll((error) => Effect.succeed(error._tag)));
      }),
    );

    expect(outcome).toBe('GuestFilesystemUnreachable');
  });

  // The VMM is there and nothing is listening on the port, which is a running guest whose files
  // this host cannot reach — not a stopped app.
  test('a running VMM with nothing on the port is refused', async () => {
    const { outcome } = await against({
      script: { onConnect: 'FAILED\n' },
      ask: (guest) => guest.list(ROOT),
    });

    expect(outcome).toBe('GuestPortUnreachable');
  });

  test('a guest that hangs up mid-answer is not read as a short one', async () => {
    const whole = replyFrame({
      status: GUEST_STATUS.ok,
      body: listingBody({ entries: [entry('pb_data')] }),
    });
    const { outcome } = await against({
      script: {
        replies: [whole.subarray(0, whole.byteLength - CUT_SHORT_BY)],
        hangUpAfterReplies: true,
      },
      ask: (guest) => guest.list(ROOT),
    });

    expect(outcome).toBe('GuestFilesystemSilent');
  });

  test('and bytes that are not a frame are refused rather than read', async () => {
    const wrong = replyFrame({ status: GUEST_STATUS.ok });
    wrong.write('XXXX', 0);
    const { outcome } = await against({
      script: { replies: [wrong] },
      ask: (guest) => guest.list(ROOT),
    });

    expect(outcome).toBe('MalformedGuestReply');
  });
});
