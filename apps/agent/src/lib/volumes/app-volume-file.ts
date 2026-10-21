import { constants } from 'node:fs';
import { type FileHandle, mkdir, open, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { FileSystem } from '@effect/platform';
import type { VolumeId } from '@repo/protocol';
import { Data, Effect, Option } from 'effect';
import { alignToSector, NBD_DIRECTORY, VolumeShrinkRefused } from '#lib/volumes/device-file.ts';

export type AppVolumeFile = { readonly mountPath: string; readonly volumeId: VolumeId };

export class AppVolumeFileUnavailable extends Data.TaggedError('AppVolumeFileUnavailable') {
  override get message() {
    return 'The app volume image could not be accessed safely.';
  }
}

class AppVolumeFileMissing extends Data.TaggedError('AppVolumeFileMissing') {}

const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
// O_PATH pins an inode without opening device nodes; Node does not expose this Linux flag.
const LINUX_O_PATH = 0o10000000;
const PIN_FLAGS = LINUX_O_PATH | constants.O_NOFOLLOW;
const CREATE_FLAGS =
  constants.O_RDWR |
  constants.O_CREAT |
  constants.O_EXCL |
  constants.O_NOFOLLOW |
  constants.O_NONBLOCK;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

function errorCode(cause: unknown) {
  return typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : undefined;
}

function native<A>(operation: () => Promise<A>) {
  return Effect.tryPromise({
    try: operation,
    catch: (cause) =>
      errorCode(cause) === 'ENOENT' ? new AppVolumeFileMissing() : new AppVolumeFileUnavailable(),
  });
}

function descriptorPath(handle: FileHandle): string {
  return `/proc/self/fd/${handle.fd}`;
}

function openHandle({ path, flags }: { path: string; flags: number }) {
  return Effect.acquireRelease(
    native(() => open(path, flags, PRIVATE_FILE_MODE)),
    (handle) => native(() => handle.close()).pipe(Effect.ignore),
  );
}

function mountedRoot(mountPath: string) {
  return Effect.gen(function* () {
    if (process.platform !== 'linux') {
      return yield* new AppVolumeFileUnavailable();
    }
    const fs = yield* FileSystem.FileSystem;
    const root = yield* openHandle({ path: mountPath, flags: DIRECTORY_FLAGS });
    const own = yield* native(() => root.stat());
    const parent = yield* fs.stat(dirname(mountPath));
    if (own.dev === parent.dev) {
      return yield* new AppVolumeFileUnavailable();
    }
    return root;
  }).pipe(Effect.mapError(() => new AppVolumeFileUnavailable()));
}

function imageDirectory({ mountPath, create }: { mountPath: string; create: boolean }) {
  return Effect.gen(function* () {
    const root = yield* mountedRoot(mountPath);
    const path = `${descriptorPath(root)}/${NBD_DIRECTORY}`;
    if (create) {
      yield* native(async () => {
        try {
          await mkdir(path, { mode: PRIVATE_DIRECTORY_MODE });
        } catch (cause) {
          if (errorCode(cause) !== 'EEXIST') {
            throw cause;
          }
        }
      });
    }
    return yield* openHandle({ path, flags: DIRECTORY_FLAGS });
  });
}

function imagePath({ directory, volumeId }: { directory: FileHandle; volumeId: VolumeId }) {
  return Effect.gen(function* () {
    if (volumeId === '.' || volumeId === '..' || volumeId.includes('/')) {
      return yield* new AppVolumeFileUnavailable();
    }
    return `${descriptorPath(directory)}/${volumeId}`;
  });
}

function writableImage(path: string) {
  return Effect.gen(function* () {
    const pinned = yield* openHandle({ path, flags: PIN_FLAGS });
    if (!(yield* native(() => pinned.stat())).isFile()) {
      return yield* new AppVolumeFileUnavailable();
    }
    return yield* openHandle({
      path: descriptorPath(pinned),
      flags: constants.O_RDWR | constants.O_NONBLOCK,
    });
  }).pipe(Effect.catchTag('AppVolumeFileMissing', () => openHandle({ path, flags: CREATE_FLAGS })));
}

export function ensureAppVolumeFile(input: AppVolumeFile & { sizeBytes: number }) {
  return Effect.scoped(
    Effect.gen(function* () {
      const directory = yield* imageDirectory({ mountPath: input.mountPath, create: true });
      const path = yield* imagePath({ directory, volumeId: input.volumeId });
      const file = yield* writableImage(path);
      const current = yield* native(() => file.stat());
      const target = alignToSector(input.sizeBytes);
      if (
        !current.isFile() ||
        !Number.isSafeInteger(current.size) ||
        !Number.isSafeInteger(target)
      ) {
        return yield* new AppVolumeFileUnavailable();
      }
      if (current.size > target) {
        return yield* new VolumeShrinkRefused({ current: current.size, requested: target });
      }
      if (current.size < target) {
        yield* native(() => file.truncate(target));
      }
      return target;
    }),
  ).pipe(
    Effect.mapError((error) =>
      error._tag === 'VolumeShrinkRefused' ? error : new AppVolumeFileUnavailable(),
    ),
  );
}

export function appVolumeFileSize(input: AppVolumeFile) {
  return Effect.scoped(
    Effect.gen(function* () {
      const directory = yield* imageDirectory({ mountPath: input.mountPath, create: false });
      const path = yield* imagePath({ directory, volumeId: input.volumeId });
      const file = yield* openHandle({ path, flags: PIN_FLAGS });
      const current = yield* native(() => file.stat());
      if (!current.isFile() || !Number.isSafeInteger(current.size)) {
        return yield* new AppVolumeFileUnavailable();
      }
      return Option.some(current.size);
    }),
  ).pipe(Effect.catchTag('AppVolumeFileMissing', () => Effect.succeedNone));
}

export function removeAppVolumeFile(input: AppVolumeFile) {
  return Effect.scoped(
    Effect.gen(function* () {
      const directory = yield* imageDirectory({ mountPath: input.mountPath, create: false });
      const path = yield* imagePath({ directory, volumeId: input.volumeId });
      yield* native(() => unlink(path));
    }),
  ).pipe(Effect.catchTag('AppVolumeFileMissing', () => Effect.void));
}
