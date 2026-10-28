import { basename, dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { FileSystem } from '@effect/platform';
import type { AppId, DesiredVolume } from '@repo/protocol';
import { Data, Effect, Option } from 'effect';
import { APP_ZEROFS_CACHE } from '#lib/volumes/app-zerofs-cache.ts';
import {
  appZerofsConfigContents,
  appZerofsPaths,
  appZerofsUnitConfigFile,
} from '#lib/volumes/app-zerofs-config.ts';
import { appZerofsFilesystem } from '#lib/volumes/app-zerofs-filesystem.ts';
import { assertAppZerofsStopped } from '#lib/volumes/app-zerofs-observation.ts';
import { readAppZerofsRetirement } from '#lib/volumes/app-zerofs-retirement.ts';
import { stopAppZerofs } from '#lib/volumes/app-zerofs-systemd.ts';
import { requireVolumeMigrationSource } from '#lib/volumes/volume-migration-source.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { stdoutOf } from '#services/command-runner.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { VolumeMigrationFences } from '#services/volume-migration-fences.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';

export class VolumeMigrationAbortFailed extends Data.TaggedError('VolumeMigrationAbortFailed') {
  override get message() {
    return 'The volume migration destination could not be cleaned up safely.';
  }
}

function requireDetachedDevice(appId: AppId) {
  return Effect.gen(function* () {
    const slot = yield* (yield* SlotAllocator).lookup(appId);
    if (Option.isNone(slot)) {
      return;
    }
    const fs = yield* FileSystem.FileSystem;
    yield* fs.readFileString(`/sys/block/${basename(slot.value.nbdDevicePath)}/pid`).pipe(
      Effect.flatMap(() => Effect.fail(new VolumeMigrationAbortFailed())),
      Effect.catchTag('SystemError', (error) =>
        error.reason === 'NotFound' ? Effect.void : Effect.fail(error),
      ),
    );
  });
}

function removeStaging(paths: ReturnType<typeof appZerofsPaths>) {
  return Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      yield* stdoutOf({ command: ['mountpoint', '--quiet', '--', '/data'] });
      // Keep the storage marker until the abandoned cache is gone, including across interruption.
      yield* fs.remove(paths.cacheDirectory, { recursive: true, force: true });
      yield* (yield* fs.open(dirname(paths.cacheDirectory), { flag: 'r' })).sync;
      yield* fs.remove(dirname(paths.configFile), { recursive: true, force: true });
      yield* (yield* fs.open(dirname(dirname(paths.configFile)), { flag: 'r' })).sync;
    }),
  );
}

function hasMatchingStaging({
  desired,
  paths,
}: {
  desired: DesiredVolume & { storage: NonNullable<DesiredVolume['storage']> };
  paths: ReturnType<typeof appZerofsPaths>;
}) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const config = yield* AgentConfig;
    const contents = yield* fs.readFileString(paths.configFile).pipe(
      Effect.map(Option.some),
      Effect.catchTag('SystemError', (error) =>
        error.reason === 'NotFound' ? Effect.succeedNone : Effect.fail(error),
      ),
    );
    if (Option.isNone(contents)) {
      if (
        (yield* fs.exists(dirname(paths.configFile))) ||
        (yield* fs.exists(paths.cacheDirectory))
      ) {
        return yield* new VolumeMigrationAbortFailed();
      }
    } else if (
      contents.value !==
      appZerofsConfigContents({
        appId: desired.appId,
        stateDir: config.stateDir,
        storage: desired.storage,
        cache: APP_ZEROFS_CACHE,
      })
    ) {
      return yield* new VolumeMigrationAbortFailed();
    }
    return Option.isSome(contents);
  });
}

/** Only before control-plane cutover, with the shared source authoritative and its guest stopped/detached. Never reuse the abandoned prefix. */
export function abortVolumeMigration(desired: DesiredVolume) {
  return Effect.gen(function* () {
    if (desired.storage === undefined || desired.desiredState !== 'present') {
      return yield* new VolumeMigrationAbortFailed();
    }
    yield* (yield* VolumeMigrationFences).requireHeld(desired.appId);
    yield* requireVolumeMigrationSource(desired);
    if (Option.isSome(yield* readAppZerofsRetirement(desired.appId))) {
      return yield* new VolumeMigrationAbortFailed();
    }
    yield* requireDetachedDevice(desired.appId);
    const config = yield* AgentConfig;
    const topology = yield* ZerofsTopology;
    const paths = appZerofsPaths({ appId: desired.appId, stateDir: config.stateDir });
    if (paths.configFile !== appZerofsUnitConfigFile(desired.appId)) {
      return yield* new VolumeMigrationAbortFailed();
    }
    const filesystem = yield* appZerofsFilesystem({
      appId: desired.appId,
      storagePrefix: desired.storage.prefix,
    });
    const registered = yield* topology.lookupAppFilesystem(desired.appId);
    if (Option.isSome(registered)) {
      const current = yield* topology.resolveAppFilesystem({
        appId: desired.appId,
        storage: desired.storage,
      });
      if (!isDeepStrictEqual(current, filesystem)) {
        return yield* new VolumeMigrationAbortFailed();
      }
    }
    const staged = yield* hasMatchingStaging({
      desired: { ...desired, storage: desired.storage },
      paths,
    });
    if (staged) {
      // No guest may use this destination; an abandoned partial copy need not become durable.
      yield* stopAppZerofs(desired.appId);
    }
    yield* assertAppZerofsStopped(desired.appId);
    yield* removeStaging(paths);
    yield* topology.unregisterAppFilesystem({
      appId: desired.appId,
      filesystem,
      storage: desired.storage,
    });
  }).pipe(Effect.mapError(() => new VolumeMigrationAbortFailed()));
}
