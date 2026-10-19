import { Data, Effect } from 'effect';
import { stageAppZerofsConfig } from '#lib/volumes/app-zerofs-config.ts';
import { stdoutOf } from '#services/command-runner.service.ts';

export class AppZerofsCacheUnavailable extends Data.TaggedError('AppZerofsCacheUnavailable') {
  override get message() {
    return 'The agent could not prepare the app ZeroFS cache on the mounted data disk.';
  }
}

export function prepareAppZerofs(config: Parameters<typeof stageAppZerofsConfig>[0]) {
  return Effect.gen(function* () {
    yield* stdoutOf({ command: ['mountpoint', '--quiet', '--', '/data'] }).pipe(
      Effect.mapError(() => new AppZerofsCacheUnavailable()),
    );
    const paths = yield* stageAppZerofsConfig(config);
    // Existing cache files may contain buffered writes; prepare only the directory itself.
    yield* stdoutOf({
      command: [
        'install',
        '--directory',
        '--mode=0700',
        '--owner=zerofs',
        '--group=zerofs',
        '--',
        paths.cacheDirectory,
      ],
    }).pipe(Effect.mapError(() => new AppZerofsCacheUnavailable()));
    return paths;
  });
}
