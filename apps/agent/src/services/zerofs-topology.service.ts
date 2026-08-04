import type { ObjectKey } from '@repo/protocol';
import { Effect } from 'effect';
import type { ZerofsFilesystem } from '#lib/volumes/topology.ts';
import { AgentConfig } from '#services/agent-config.service.ts';

/**
 * **v1 runs one ZeroFS per host**, so every volume placed here shares one prefix — one process,
 * one cache, one S3 client, and the only shape whose cost does not scale with tenant count. What
 * it costs is that the validated restore property becomes per host rather than per app.
 *
 * The invariant that holds under either shape: **exactly one read-write `zerofs run` per storage
 * prefix, fleet-wide.** A second writer is fenced by SlateDB's epoch only after a window of
 * acknowledging writes that are then discarded, so the agent never starts ZeroFS — systemd's
 * single-instance guarantee is the lock.
 */
export class ZerofsTopology extends Effect.Service<ZerofsTopology>()('ZerofsTopology', {
  effect: Effect.gen(function* () {
    const config = yield* AgentConfig;
    const filesystems: readonly [ZerofsFilesystem, ...ZerofsFilesystem[]] = [
      {
        storagePrefix: config.zerofsStoragePrefix as ObjectKey,
        mountPath: config.zerofsMount,
        nbdSocketPath: config.zerofsNbdSocket,
        admin: { binary: config.zerofsBinary, configFile: config.zerofsConfigFile },
      },
    ];
    return { place: () => filesystems[0], all: filesystems };
  }),
  dependencies: [AgentConfig.Default],
}) {}
