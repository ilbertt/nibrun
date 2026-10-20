import { isDeepStrictEqual } from 'node:util';
import { type AppId, ObjectKeySchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect, Option, Ref } from 'effect';
import { AppZerofsFlushError } from '#lib/volumes/app-zerofs-durability.ts';
import { AppZerofsFilesystemConflict } from '#lib/volumes/app-zerofs-filesystem.ts';
import type { ZerofsFilesystem, ZerofsLiveFilesystem } from '#lib/volumes/topology.ts';
import { flush } from '#lib/volumes/zerofs.ts';
import { AgentConfig } from '#services/agent-config.service.ts';

/**
 * **v1 runs one ZeroFS per host**, so every volume placed here shares one prefix — one process,
 * one cache, one S3 client, and the only shape whose cost does not scale with tenant count. What
 * it costs is that the validated restore property becomes per host rather than per app.
 *
 * The invariant that holds under either shape: **exactly one read-write `zerofs run` per storage
 * prefix, fleet-wide.** A second *writer* is fenced by SlateDB's epoch only after a window of
 * acknowledging writes that are then discarded, so the agent never starts the read-write server
 * — `nibrun-zerofs.service` is non-templated and systemd's single-instance guarantee is the lock.
 *
 * A checkpoint server is not a second writer and does not touch that. It is started with
 * `--checkpoint`, which ZeroFS refuses to open read-write at all, and it reads a pinned manifest
 * that no longer advances — so it takes no epoch and cannot acknowledge anything. The agent does
 * start those, one templated instance per checkpoint, which is why the invariant above is worded
 * about writers rather than about processes. Nothing here is permission to start a second writer:
 * that remains something only systemd may do, and only once.
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
    const appFilesystems = yield* Ref.make<ReadonlyMap<AppId, ZerofsLiveFilesystem>>(new Map());

    const lookupAppFilesystem = Effect.fn('ZerofsTopology.lookupAppFilesystem')((appId: AppId) =>
      Effect.map(Ref.get(appFilesystems), (registered) =>
        Option.map(Option.fromNullable(registered.get(appId)), (filesystem) => ({
          ...filesystem,
          admin: { ...filesystem.admin },
        })),
      ),
    );

    /** Register only ready filesystems under exclusive writer ownership for the instance's lifetime. */
    const registerAppFilesystem = Effect.fn('ZerofsTopology.registerAppFilesystem')(function* ({
      appId,
      filesystem,
    }: {
      appId: AppId;
      filesystem: ZerofsLiveFilesystem;
    }) {
      const registered = { ...filesystem, admin: { ...filesystem.admin } };
      const accepted = yield* Ref.modify(appFilesystems, (current) => {
        const existing = current.get(appId);
        if (existing !== undefined) {
          return [isDeepStrictEqual(existing, registered), current] as const;
        }
        const occupied = [...filesystems, ...current.values()].some(
          (other) =>
            other.mountPath === registered.mountPath ||
            other.nbdSocketPath === registered.nbdSocketPath ||
            other.admin.configFile === registered.admin.configFile,
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
        ([appId, filesystem]) =>
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
      registerAppFilesystem,
      flushAll,
    };
  }),
  dependencies: [AgentConfig.Default],
}) {}
