import type { Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { type Sha256Digest, Sha256DigestSchema, type VolumeId } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Data, Effect } from 'effect';
import { openAppVolumeImage } from '#lib/volumes/app-volume-file.ts';
import { isSectorAligned } from '#lib/volumes/device-file.ts';
import type { ZerofsLiveFilesystem } from '#lib/volumes/topology.ts';
import { flush } from '#lib/volumes/zerofs.ts';

const COPY_BUFFER_BYTES = 1_048_576;

export type VolumeImageCopy = { sizeBytes: number; digest: Sha256Digest };
export type VolumeImageCopyInput = {
  source: ZerofsLiveFilesystem;
  destination: ZerofsLiveFilesystem;
  volumeId: VolumeId;
  sizeBytes: number;
};

export class VolumeImageCopyFailed extends Data.TaggedError('VolumeImageCopyFailed') {
  override get message() {
    return 'The volume image could not be copied safely.';
  }
}

export class VolumeImageVerificationFailed extends Data.TaggedError(
  'VolumeImageVerificationFailed',
) {
  override get message() {
    return 'The copied volume image could not be verified.';
  }
}

function native<A>(operation: () => Promise<A>) {
  // FileHandle I/O cannot be cancelled; finish the syscall before a scope closes its descriptor.
  return Effect.tryPromise({ try: operation, catch: () => new VolumeImageCopyFailed() }).pipe(
    Effect.uninterruptible,
  );
}

export function inspectVolumeImage({ image, sizeBytes }: { image: FileHandle; sizeBytes: number }) {
  return Effect.gen(function* () {
    const current = yield* native(() => image.stat());
    if (
      !Number.isSafeInteger(sizeBytes) ||
      sizeBytes <= 0 ||
      !isSectorAligned(sizeBytes) ||
      !current.isFile() ||
      current.size !== sizeBytes
    ) {
      return yield* new VolumeImageVerificationFailed();
    }
    return current;
  });
}

function assertUnchanged({ before, after }: { before: Stats; after: Stats }) {
  return before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs
    ? Effect.void
    : Effect.fail(new VolumeImageVerificationFailed());
}

function writeChunk({
  image,
  bytes,
  position,
}: {
  image: FileHandle;
  bytes: Uint8Array;
  position: number;
}) {
  return Effect.gen(function* () {
    let written = 0;
    while (written < bytes.length) {
      const result = yield* native(() =>
        image.write(bytes, written, bytes.length - written, position + written),
      );
      if (result.bytesWritten === 0) {
        return yield* new VolumeImageCopyFailed();
      }
      written += result.bytesWritten;
    }
  });
}

export function copyImageBytes({
  source,
  destination,
  sizeBytes,
}: {
  source: FileHandle;
  destination: FileHandle;
  sizeBytes: number;
}) {
  return Effect.gen(function* () {
    const before = yield* inspectVolumeImage({ image: source, sizeBytes });
    const target = yield* native(() => destination.stat());
    if (!target.isFile() || target.size !== 0) {
      return yield* new VolumeImageCopyFailed();
    }
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    const zeroes = Buffer.alloc(COPY_BUFFER_BYTES);
    const hash = new Bun.CryptoHasher('sha256');
    let offset = 0;
    while (offset < sizeBytes) {
      const { bytesRead } = yield* native(() =>
        source.read(buffer, 0, Math.min(buffer.length, sizeBytes - offset), offset),
      );
      if (bytesRead === 0) {
        return yield* new VolumeImageVerificationFailed();
      }
      const bytes = buffer.subarray(0, bytesRead);
      hash.update(bytes);
      if (!bytes.equals(zeroes.subarray(0, bytesRead))) {
        yield* writeChunk({ image: destination, bytes, position: offset });
      }
      offset += bytesRead;
      yield* Effect.yieldNow();
    }
    yield* assertUnchanged({ before, after: yield* native(() => source.stat()) });
    if ((yield* native(() => destination.stat())).size > sizeBytes) {
      return yield* new VolumeImageVerificationFailed();
    }
    yield* native(() => destination.truncate(sizeBytes));
    yield* native(() => destination.sync());
    return {
      sizeBytes,
      digest: Value.Parse(Sha256DigestSchema, hash.digest('hex')),
    } satisfies VolumeImageCopy;
  });
}

export function verifyImageBytes({
  image,
  sizeBytes,
  digest,
}: VolumeImageCopy & { image: FileHandle }) {
  return Effect.gen(function* () {
    const before = yield* inspectVolumeImage({ image, sizeBytes });
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    const hash = new Bun.CryptoHasher('sha256');
    let offset = 0;
    while (offset < sizeBytes) {
      const { bytesRead } = yield* native(() =>
        image.read(buffer, 0, Math.min(buffer.length, sizeBytes - offset), offset),
      );
      if (bytesRead === 0) {
        return yield* new VolumeImageVerificationFailed();
      }
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
      yield* Effect.yieldNow();
    }
    yield* assertUnchanged({ before, after: yield* native(() => image.stat()) });
    if (hash.digest('hex') !== digest) {
      return yield* new VolumeImageVerificationFailed();
    }
  });
}

/** Requires flushed, detached guest storage and exclusive destination ownership. Failed copies need a fresh destination. */
export function copyVolumeImage(input: VolumeImageCopyInput) {
  return Effect.scoped(
    Effect.gen(function* () {
      const source = yield* openAppVolumeImage({
        mountPath: input.source.mountPath,
        volumeId: input.volumeId,
        access: 'read',
      });
      const sourceBefore = yield* inspectVolumeImage({ image: source, sizeBytes: input.sizeBytes });
      const destination = yield* openAppVolumeImage({
        mountPath: input.destination.mountPath,
        volumeId: input.volumeId,
        access: 'create',
      });
      const receipt = yield* copyImageBytes({ source, destination, sizeBytes: input.sizeBytes });
      yield* flush(input.destination.admin);
      const reopened = yield* openAppVolumeImage({
        mountPath: input.destination.mountPath,
        volumeId: input.volumeId,
        access: 'read',
      });
      const created = yield* native(() => destination.stat());
      const current = yield* native(() => reopened.stat());
      if (created.dev !== current.dev || created.ino !== current.ino) {
        return yield* new VolumeImageVerificationFailed();
      }
      yield* verifyImageBytes({ image: reopened, ...receipt });
      yield* assertUnchanged({ before: sourceBefore, after: yield* native(() => source.stat()) });
      return receipt;
    }),
  ).pipe(
    Effect.mapError((error) =>
      error._tag === 'VolumeImageVerificationFailed' ? error : new VolumeImageCopyFailed(),
    ),
  );
}
