import { isDeepStrictEqual } from 'node:util';
import { FileSystem } from '@effect/platform';
import type { DesiredVolume } from '@repo/protocol';
import { Effect, Option } from 'effect';
import { activateAppZerofs } from '#lib/volumes/app-zerofs-activation.ts';
import { APP_ZEROFS_CACHE } from '#lib/volumes/app-zerofs-cache.ts';
import {
  AppZerofsConfigConflict,
  AppZerofsConfigUnavailable,
  appZerofsConfigContents,
  appZerofsPaths,
} from '#lib/volumes/app-zerofs-config.ts';
import { flushAndStopAppZerofs } from '#lib/volumes/app-zerofs-durability.ts';
import {
  AppZerofsFilesystemConflict,
  appZerofsFilesystem,
} from '#lib/volumes/app-zerofs-filesystem.ts';
import { assertAppZerofsStopped } from '#lib/volumes/app-zerofs-observation.ts';
import {
  AppZerofsRetirementUnavailable,
  appZerofsConfigDigest,
  readAppZerofsRetirement,
  syncAppZerofsRetirement,
  writeAppZerofsRetirement,
} from '#lib/volumes/app-zerofs-retirement.ts';
import { inspectAttachment } from '#lib/volumes/nbd.ts';
import {
  AppVolumeUnavailable,
  assertNoSharedVolume,
  selectVolumeFilesystem,
} from '#lib/volumes/placement.ts';
import { deletedVolumeReport, teardownVolume } from '#lib/volumes/teardown.ts';
import type { ZerofsLiveFilesystem } from '#lib/volumes/topology.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';

type ConfiguredVolume = DesiredVolume & { storage: NonNullable<DesiredVolume['storage']> };

function deleteStagedVolume({
  desired,
  filesystem,
  contents,
}: {
  desired: ConfiguredVolume;
  filesystem: ZerofsLiveFilesystem;
  contents: string;
}) {
  return Effect.gen(function* () {
    const config = yield* AgentConfig;
    const fs = yield* FileSystem.FileSystem;
    const topology = yield* ZerofsTopology;
    const allocator = yield* SlotAllocator;
    const staged = yield* fs
      .readFileString(
        appZerofsPaths({ appId: desired.appId, stateDir: config.stateDir }).configFile,
      )
      .pipe(Effect.mapError(() => new AppZerofsConfigUnavailable()));
    if (staged !== contents) {
      return yield* new AppZerofsConfigConflict();
    }
    if (Option.isSome(yield* topology.lookupAppFilesystem(desired.appId))) {
      const registered = yield* topology.resolveAppFilesystem({
        appId: desired.appId,
        storage: desired.storage,
      });
      if (!isDeepStrictEqual(registered, filesystem)) {
        return yield* new AppZerofsFilesystemConflict();
      }
    }
    yield* assertNoSharedVolume(desired);
    const slot = yield* allocator.lookup(desired.appId);
    if (Option.isSome(slot)) {
      yield* inspectAttachment({
        socketPath: filesystem.nbdSocketPath,
        devicePath: slot.value.nbdDevicePath,
        volumeId: desired.volumeId,
      });
    }
    // Reopen only an already-staged backend so deletion can resume after an agent or host restart.
    yield* activateAppZerofs({
      appId: desired.appId,
      storage: desired.storage,
      cache: APP_ZEROFS_CACHE,
    });
    yield* selectVolumeFilesystem(desired);
    yield* teardownVolume({ desired, filesystem });
    yield* flushAndStopAppZerofs(desired.appId);
    yield* assertAppZerofsStopped(desired.appId);
  });
}

/** Only explicit deletion may retire a writer; guests must already be stopped. */
export function retireAppVolume(desired: DesiredVolume) {
  return Effect.gen(function* () {
    if (desired.storage === undefined || desired.desiredState !== 'absent') {
      return yield* new AppVolumeUnavailable();
    }
    const config = yield* AgentConfig;
    const topology = yield* ZerofsTopology;
    const allocator = yield* SlotAllocator;
    const filesystem = yield* appZerofsFilesystem({
      appId: desired.appId,
      storagePrefix: desired.storage.prefix,
    });
    const contents = appZerofsConfigContents({
      appId: desired.appId,
      stateDir: config.stateDir,
      storage: desired.storage,
      cache: APP_ZEROFS_CACHE,
    });
    const configDigest = appZerofsConfigDigest(contents);
    const retirement = yield* readAppZerofsRetirement(desired.appId);
    if (Option.isSome(retirement)) {
      if (
        retirement.value.volumeId !== desired.volumeId ||
        retirement.value.configDigest !== configDigest
      ) {
        return yield* new AppZerofsRetirementUnavailable();
      }
      yield* syncAppZerofsRetirement(desired.appId);
    } else {
      yield* deleteStagedVolume({
        desired: { ...desired, storage: desired.storage },
        filesystem,
        contents,
      });
      yield* writeAppZerofsRetirement({
        appId: desired.appId,
        volumeId: desired.volumeId,
        configDigest,
      });
    }
    yield* topology.unregisterAppFilesystem({
      appId: desired.appId,
      filesystem,
      storage: desired.storage,
    });
    yield* allocator.release(desired.appId);
    return deletedVolumeReport(desired);
  });
}
