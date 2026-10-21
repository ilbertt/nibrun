import { join } from 'node:path';
import { FileSystem } from '@effect/platform';
import { Data, Effect } from 'effect';
import {
  APP_ZEROFS_CONFIG_FILENAME,
  appZerofsConfigDirectory,
} from '#lib/volumes/app-zerofs-config.ts';
import { readCacheDiskBytes, readCacheMemoryBytes } from '#lib/volumes/zerofs.ts';

export class AppZerofsCacheUnknown extends Data.TaggedError('AppZerofsCacheUnknown') {
  override get message() {
    return 'The app ZeroFS cache reservations could not be read.';
  }
}

function readAppCacheBytes({
  stateDir,
  read,
}: {
  stateDir: string;
  read: typeof readCacheMemoryBytes;
}) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = appZerofsConfigDirectory(stateDir);
    const apps = yield* fs
      .readDirectory(directory)
      .pipe(
        Effect.catchTag('SystemError', (error) =>
          error.reason === 'NotFound' ? Effect.succeed([]) : Effect.fail(error),
        ),
      );
    // Staged writers can outlive the agent and its in-memory filesystem registry.
    let bytes = 0;
    for (const app of apps) {
      bytes += yield* read(join(directory, app, APP_ZEROFS_CONFIG_FILENAME));
    }
    if (!Number.isFinite(bytes)) {
      return yield* new AppZerofsCacheUnknown();
    }
    return bytes;
  }).pipe(Effect.mapError(() => new AppZerofsCacheUnknown()));
}

export function readAppZerofsCacheMemoryBytes(stateDir: string) {
  return readAppCacheBytes({ stateDir, read: readCacheMemoryBytes });
}

export function readAppZerofsCacheDiskBytes(stateDir: string) {
  return readAppCacheBytes({ stateDir, read: readCacheDiskBytes });
}
