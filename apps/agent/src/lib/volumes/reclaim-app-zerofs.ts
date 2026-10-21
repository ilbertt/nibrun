import { dirname } from 'node:path';
import { FileSystem } from '@effect/platform';
import { type AppId, AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect, Either, Option } from 'effect';
import { appZerofsPaths } from '#lib/volumes/app-zerofs-config.ts';
import { assertAppZerofsStopped } from '#lib/volumes/app-zerofs-observation.ts';
import {
  AppZerofsRetirementUnavailable,
  appZerofsConfigDigest,
  appZerofsRetirementDirectory,
  readAppZerofsRetirement,
  writeAppZerofsRetirement,
} from '#lib/volumes/app-zerofs-retirement.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { stdoutOf } from '#services/command-runner.service.ts';

const RETIREMENT_SUFFIX = '.json';

function syncRemovedDirectories(paths: ReturnType<typeof appZerofsPaths>) {
  return Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      for (const directory of [dirname(paths.cacheDirectory), dirname(dirname(paths.configFile))]) {
        yield* (yield* fs.open(directory, { flag: 'r' })).sync;
      }
    }),
  );
}

function reclaimRecord({ name, retainedApps }: { name: string; retainedApps: ReadonlySet<AppId> }) {
  return Effect.gen(function* () {
    const appId = name.slice(0, -RETIREMENT_SUFFIX.length);
    if (!Value.Check(AppIdSchema, appId)) {
      return yield* new AppZerofsRetirementUnavailable();
    }
    if (retainedApps.has(appId)) {
      return;
    }
    const retirement = yield* readAppZerofsRetirement(appId);
    if (Option.isNone(retirement) || retirement.value.cleaned === true) {
      return;
    }
    const config = yield* AgentConfig;
    const fs = yield* FileSystem.FileSystem;
    const paths = appZerofsPaths({ appId, stateDir: config.stateDir });
    const contents = yield* fs.readFileString(paths.configFile).pipe(
      Effect.map(Option.some),
      Effect.catchTag('SystemError', (error) =>
        error.reason === 'NotFound' ? Effect.succeedNone : Effect.fail(error),
      ),
    );
    if (
      Option.isSome(contents) &&
      appZerofsConfigDigest(contents.value) !== retirement.value.configDigest
    ) {
      return yield* new AppZerofsRetirementUnavailable();
    }
    yield* assertAppZerofsStopped(appId);
    yield* stdoutOf({ command: ['mountpoint', '--quiet', '--', '/data'] });
    yield* fs.remove(paths.cacheDirectory, { recursive: true, force: true });
    yield* fs.remove(dirname(paths.configFile), { recursive: true, force: true });
    yield* syncRemovedDirectories(paths);
    // Keep the retirement tombstone: cached desired state must never resurrect deleted storage.
    yield* writeAppZerofsRetirement({ ...retirement.value, cleaned: true });
  });
}

export function reclaimAppZerofs(retainedApps: ReadonlySet<AppId>) {
  return Effect.gen(function* () {
    const config = yield* AgentConfig;
    const fs = yield* FileSystem.FileSystem;
    const files = yield* fs
      .readDirectory(appZerofsRetirementDirectory(config.stateDir))
      .pipe(
        Effect.catchTag('SystemError', (error) =>
          error.reason === 'NotFound' ? Effect.succeed([]) : Effect.fail(error),
        ),
      );
    const results = yield* Effect.forEach(
      files.filter((name) => name.endsWith(RETIREMENT_SUFFIX)),
      (name) => Effect.either(reclaimRecord({ name, retainedApps })),
    );
    if (results.some(Either.isLeft)) {
      return yield* new AppZerofsRetirementUnavailable();
    }
  }).pipe(
    Effect.mapError(() => new AppZerofsRetirementUnavailable()),
    Effect.asVoid,
  );
}
