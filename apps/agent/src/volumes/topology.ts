import type { ObjectKey } from '@repo/protocol';
import { Effect } from 'effect';
import { AgentConfig } from '#config.ts';
import type { ZerofsAdmin } from '#volumes/zerofs.ts';

/**
 * One ZeroFS filesystem is one `[storage] url` prefix. A device file lives inside a filesystem,
 * so the prefix a volume names decides which ZeroFS serves it.
 *
 * `mountPath` is the host's own mount, where `.nbd/<volume-id>` is created and sized. What that
 * file contains is an image the host never asks its kernel to interpret.
 */
export type ZerofsFilesystem = {
  readonly storagePrefix: ObjectKey;
  readonly mountPath: string;
  readonly nbdSocketPath: string;
  readonly admin: ZerofsAdmin;
};

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
