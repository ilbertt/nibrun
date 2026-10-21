import { isDeepStrictEqual } from 'node:util';
import { type AppId, ObjectKeySchema, type S3VolumeStorage } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect, Option, Ref } from 'effect';
import { AppZerofsConfigConflict } from '#lib/volumes/app-zerofs-config.ts';
import { AppZerofsFlushError } from '#lib/volumes/app-zerofs-durability.ts';
import {
  AppZerofsFilesystemConflict,
  AppZerofsFilesystemUnavailable,
} from '#lib/volumes/app-zerofs-filesystem.ts';
import type { AppZerofsRegistration, ZerofsFilesystem } from '#lib/volumes/topology.ts';
import { flush } from '#lib/volumes/zerofs.ts';
import { AgentConfig } from '#services/agent-config.service.ts';

/**
 * Exactly one read-write ZeroFS process may own a storage prefix fleet-wide. SlateDB fences a
 * second writer only after a window of acknowledging writes that are then discarded. Per-app
 * activation therefore requires exclusive control-plane ownership before registering a writer.
 * Shared placement remains host-wide; checkpoint servers open pinned manifests read-only and
 * never take a writer epoch.
 */
export class ZerofsTopology extends Effect.Service<ZerofsTopology>()('ZerofsTopology', {
  effect: Effect.gen(function* () {
    const config = yield* AgentConfig;
    const filesystems: readonly [ZerofsFilesystem, ...ZerofsFilesystem[]] = [
      {
        storagePrefix: Value.Parse(ObjectKeySchema, config.zerofsStoragePrefix),
        mountPath: config.zerofsMount,
        nbdSocketPath: config.zerofsNbdSocket,
        checkpointRuntimeDir: config.zerofsCheckpointRuntimeDir,
        admin: { binary: config.zerofsBinary, configFile: config.zerofsConfigFile },
      },
    ];
    const appFilesystems = yield* Ref.make<ReadonlyMap<AppId, AppZerofsRegistration>>(new Map());

    const lookupAppFilesystem = Effect.fn('ZerofsTopology.lookupAppFilesystem')((appId: AppId) =>
      Effect.map(Ref.get(appFilesystems), (registered) =>
        Option.map(Option.fromNullable(registered.get(appId)), ({ filesystem }) => ({
          ...filesystem,
          admin: { ...filesystem.admin },
        })),
      ),
    );

    const resolveAppFilesystem = Effect.fn('ZerofsTopology.resolveAppFilesystem')(function* ({
      appId,
      storage,
    }: {
      appId: AppId;
      storage: S3VolumeStorage;
    }) {
      const registered = (yield* Ref.get(appFilesystems)).get(appId);
      if (registered === undefined) {
        return yield* new AppZerofsFilesystemUnavailable();
      }
      if (!isDeepStrictEqual(registered.storage, storage)) {
        return yield* new AppZerofsConfigConflict();
      }
      return { ...registered.filesystem, admin: { ...registered.filesystem.admin } };
    });

    /** Register only ready filesystems under exclusive writer ownership for the instance's lifetime. */
    const registerAppFilesystem = Effect.fn('ZerofsTopology.registerAppFilesystem')(function* ({
      appId,
      filesystem,
      storage,
    }: AppZerofsRegistration & { appId: AppId }) {
      if (storage.prefix !== filesystem.storagePrefix) {
        return yield* new AppZerofsConfigConflict();
      }
      const registered: AppZerofsRegistration = {
        filesystem: { ...filesystem, admin: { ...filesystem.admin } },
        storage: { ...storage, auth: { ...storage.auth } },
      };
      const accepted = yield* Ref.modify(appFilesystems, (current) => {
        const existing = current.get(appId);
        if (existing !== undefined) {
          return [isDeepStrictEqual(existing, registered), current] as const;
        }
        const occupied = [
          ...filesystems,
          ...Array.from(current.values(), (entry) => entry.filesystem),
        ].some(
          (other) =>
            other.mountPath === filesystem.mountPath ||
            other.nbdSocketPath === filesystem.nbdSocketPath ||
            other.admin.configFile === filesystem.admin.configFile,
        );
        return occupied
          ? ([false, current] as const)
          : ([true, new Map(current).set(appId, registered)] as const);
      });
      if (!accepted) {
        return yield* new AppZerofsFilesystemConflict();
      }
    });

    const flushApps = Effect.flatMap(Ref.get(appFilesystems), (registered) =>
      Effect.forEach(
        registered,
        ([appId, { filesystem }]) =>
          flush(filesystem.admin).pipe(
            Effect.mapError(() => new AppZerofsFlushError()),
            Effect.catchAll((error) =>
              Effect.logWarning('app zerofs flush failed', error).pipe(
                Effect.annotateLogs({ appId }),
              ),
            ),
          ),
        { discard: true },
      ),
    );
    /**
     * Every filesystem on the host brought to a durability point. Under `ignore_fsync` the guest's
     * own flushes are a no-op, so this is the whole of what stands between a microVM going down —
     * stopped or asleep — and the loss of everything since the last periodic flush.
     *
     * Best-effort per filesystem, and deliberately: a microVM nothing could take down because a
     * flush failed is worse than one taken down having lost what the flush would have saved.
     */
    const flushAll = Effect.forEach(
      filesystems,
      (filesystem) =>
        flush(filesystem.admin).pipe(
          Effect.catchAll((error) =>
            Effect.logWarning('zerofs flush failed', error).pipe(
              Effect.annotateLogs({ storagePrefix: filesystem.storagePrefix }),
            ),
          ),
        ),
      { discard: true },
    ).pipe(Effect.andThen(flushApps), Effect.withSpan('ZerofsTopology.flushAll'));

    return {
      place: () => filesystems[0],
      all: filesystems,
      lookupAppFilesystem,
      resolveAppFilesystem,
      registerAppFilesystem,
      flushAll,
    };
  }),
  dependencies: [AgentConfig.Default],
}) {}
