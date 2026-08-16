import { ObjectKeySchema, Value } from '@repo/protocol';
import { Effect } from 'effect';
import type { ZerofsFilesystem } from '#lib/volumes/topology.ts';
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
    return { place: () => filesystems[0], all: filesystems };
  }),
  dependencies: [AgentConfig.Default],
}) {}
