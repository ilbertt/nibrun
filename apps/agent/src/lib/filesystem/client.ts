import { Buffer } from 'node:buffer';
import type { AppId, DirectoryListing, GuestPath } from '@repo/protocol';
import { Data, Duration, Effect } from 'effect';
import {
  decodeCompute,
  decodeDetails,
  decodeHeader,
  decodeListing,
  decodeUsage,
  decodeWritten,
  encodeRequest,
  type FilesystemDetails,
  FRAME_HEADER_BYTES,
  fitsOneRequest,
  GUEST_FILESYSTEM_CHUNK_BYTES,
  GuestFilesystemRefused,
  type GuestFilesystemRequest,
  GuestRequestTooLarge,
  isRefusal,
  type MalformedGuestReply,
  type MeasuredBytes,
  type MeasuredCompute,
} from '#lib/filesystem/protocol.ts';
import {
  connectRequest,
  dialGuest,
  GUEST_FILESYSTEM_VSOCK_PORT,
  guestVsockPath,
  readConnectReply,
  vmWorkingDir,
} from '#lib/vm/vsock.ts';

/**
 * The host's end of the guest's filesystem port.
 *
 * Every answer comes from a `readdir`, a `pread` or a `pwrite` inside the microVM, against the
 * filesystem the tenant has mounted — so a listing is what is there rather than what had reached
 * the block device by the last flush, and a write is possible at all, which it never was from
 * outside a mount the guest holds read-write.
 *
 * One connection serves as many requests as the caller makes: browsing is many small reads and an
 * upload is many more, and the guest holds nothing between them.
 */

/** A listing is read while somebody waits for it, so this is bounded well below the export path's hour. */
const REPLY_TIMEOUT_SECONDS = 20;
const REPLY_TIMEOUT = Duration.seconds(REPLY_TIMEOUT_SECONDS);

const EMPTY_BODY = Buffer.alloc(0);

export class GuestFilesystemUnreachable extends Data.TaggedError('GuestFilesystemUnreachable')<{
  readonly appId: AppId;
  readonly cause: unknown;
}> {
  override get message() {
    return `no microVM is running on this host for ${this.appId}, so its files cannot be reached`;
  }
}

export class GuestFilesystemSilent extends Data.TaggedError('GuestFilesystemSilent')<{
  readonly appId: AppId;
}> {
  override get message() {
    return `the guest running ${this.appId} took a request about its files and never answered`;
  }
}

export type GuestFilesystem = {
  readonly list: (path: GuestPath) => Effect.Effect<DirectoryListing, GuestFilesystemError>;
  readonly stat: (path: GuestPath) => Effect.Effect<FilesystemDetails, GuestFilesystemError>;
  /** How full the volume is. No path, because the volume is one filesystem all the way down. */
  readonly usage: () => Effect.Effect<MeasuredBytes, GuestFilesystemError>;
  /** What the guest is spending. No path either: this one is not about the filesystem at all. */
  readonly compute: () => Effect.Effect<MeasuredCompute, GuestFilesystemError>;
  /** Short of `length` is the end of the file, which is how a reader in chunks learns to stop. */
  readonly read: (request: {
    readonly path: GuestPath;
    readonly offset: number;
    readonly length: number;
  }) => Effect.Effect<Buffer, GuestFilesystemError>;
  /** `truncate` cuts the file at `offset` first, so a replacement leaves none of the old tail. */
  readonly write: (request: {
    readonly path: GuestPath;
    readonly offset: number;
    readonly content: Uint8Array;
    readonly truncate: boolean;
  }) => Effect.Effect<number, GuestFilesystemError>;
  readonly makeDirectory: (path: GuestPath) => Effect.Effect<void, GuestFilesystemError>;
  /** One entry, never a tree: a directory that still holds something is refused. */
  readonly remove: (path: GuestPath) => Effect.Effect<void, GuestFilesystemError>;
  readonly move: (request: {
    readonly path: GuestPath;
    readonly destination: GuestPath;
  }) => Effect.Effect<void, GuestFilesystemError>;
};

export type GuestFilesystemError =
  | GuestFilesystemSilent
  | GuestFilesystemRefused
  | GuestRequestTooLarge
  | MalformedGuestReply;

/**
 * Scoped, because the connection is the resource: the guest gives a worker to whoever is holding
 * one and takes it back when the socket closes, so a caller that leaks one costs the tenant a
 * process until the connection times out.
 */
export const guestFilesystem = Effect.fn('guestFilesystem')(function* ({
  appId,
  vmDir,
}: {
  appId: AppId;
  vmDir: string;
}) {
  const socketPath = guestVsockPath({ workingDir: vmWorkingDir({ vmDir, appId }) });
  const wire = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () => dialGuest({ socketPath }),
      catch: (cause) => new GuestFilesystemUnreachable({ appId, cause }),
    }),
    (dialled) => Effect.sync(() => dialled.close()),
  );

  const awaited = <A>(answer: () => Promise<A>) =>
    Effect.tryPromise({
      try: answer,
      catch: () => new GuestFilesystemSilent({ appId }),
    }).pipe(
      Effect.timeoutFail({
        duration: REPLY_TIMEOUT,
        onTimeout: () => new GuestFilesystemSilent({ appId }),
      }),
    );

  wire.send(connectRequest(GUEST_FILESYSTEM_VSOCK_PORT));
  yield* readConnectReply({
    reply: yield* awaited(() => wire.receiveLine()),
    port: GUEST_FILESYSTEM_VSOCK_PORT,
  });

  const exchange = (request: GuestFilesystemRequest) =>
    Effect.gen(function* () {
      if (!fitsOneRequest(request)) {
        return yield* new GuestRequestTooLarge({ appId });
      }
      wire.send(encodeRequest(request));
      const { status, bodyLength } = yield* decodeHeader(
        yield* awaited(() => wire.receive(FRAME_HEADER_BYTES)),
      );
      const body = bodyLength === 0 ? EMPTY_BODY : yield* awaited(() => wire.receive(bodyLength));
      return isRefusal(status) ? yield* new GuestFilesystemRefused({ appId, status }) : body;
    });

  return {
    list: (path) =>
      Effect.flatMap(exchange({ verb: 'list', path }), (body) => decodeListing({ body, path })),
    stat: (path) => Effect.flatMap(exchange({ verb: 'stat', path }), decodeDetails),
    usage: () => Effect.flatMap(exchange({ verb: 'usage' }), decodeUsage),
    compute: () => Effect.flatMap(exchange({ verb: 'compute' }), decodeCompute),
    read: ({ path, offset, length }) =>
      exchange({
        verb: 'read',
        path,
        offset,
        length: Math.min(length, GUEST_FILESYSTEM_CHUNK_BYTES),
      }),
    write: ({ path, offset, content, truncate }) =>
      Effect.flatMap(exchange({ verb: 'write', path, offset, content, truncate }), decodeWritten),
    makeDirectory: (path) => Effect.asVoid(exchange({ verb: 'makeDirectory', path })),
    remove: (path) => Effect.asVoid(exchange({ verb: 'remove', path })),
    move: ({ path, destination }) => Effect.asVoid(exchange({ verb: 'move', path, destination })),
  } satisfies GuestFilesystem;
});
