import { FileSystem } from '@effect/platform';
import { Effect } from 'effect';
import {
  type AppVolumeFile,
  appVolumeFileSize,
  ensureAppVolumeFile,
  removeAppVolumeFile,
} from '#lib/volumes/app-volume-file.ts';

export class AppVolumeFiles extends Effect.Service<AppVolumeFiles>()('AppVolumeFiles', {
  effect: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return {
      ensure: Effect.fn('AppVolumeFiles.ensure')((input: AppVolumeFile & { sizeBytes: number }) =>
        ensureAppVolumeFile(input).pipe(Effect.provideService(FileSystem.FileSystem, fs)),
      ),
      size: Effect.fn('AppVolumeFiles.size')((input: AppVolumeFile) =>
        appVolumeFileSize(input).pipe(Effect.provideService(FileSystem.FileSystem, fs)),
      ),
      remove: Effect.fn('AppVolumeFiles.remove')((input: AppVolumeFile) =>
        removeAppVolumeFile(input).pipe(Effect.provideService(FileSystem.FileSystem, fs)),
      ),
    };
  }),
}) {}
