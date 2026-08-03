import type { ObjectKey } from '@repo/protocol';
import type { CommandRunner } from '#lib/exec.ts';
import { ZerofsAdmin } from '#volumes/zerofs.ts';

/**
 * One ZeroFS filesystem, which is one `[storage] url` prefix.
 *
 * A device file lives *inside* a ZeroFS filesystem, so the prefix a volume names decides which
 * ZeroFS serves it. That makes the number of ZeroFS instances per host a real topology choice
 * rather than a deployment detail — see the note on {@link ZerofsTopology.sharedHostFilesystem}.
 */
export type ZerofsFilesystem = {
  storagePrefix: ObjectKey;
  // The host's own mount of ZeroFS's filesystem, where `.nbd/<volume-id>` is created and sized.
  //
  // This is not the tenant's ext4. The host mounts ZeroFS and writes a sparse *file* into it;
  // what that file contains is a filesystem image the host never asks its kernel to interpret.
  // The rule the export design depends on is that the kernel never parses tenant-controlled
  // filesystem metadata, and it is intact — this looks like a violation and is not.
  mountPath: string;
  nbdSocketPath: string;
  configFile: string;
  admin: ZerofsAdmin;
};

export class UnservedStoragePrefixError extends Error {
  readonly storagePrefix: ObjectKey;

  constructor({ storagePrefix, served }: { storagePrefix: ObjectKey; served: readonly string[] }) {
    super(
      `No ZeroFS on this host serves ${storagePrefix}; it serves ${served.join(', ') || 'nothing'}`,
    );
    this.name = 'UnservedStoragePrefixError';
    this.storagePrefix = storagePrefix;
  }
}

/**
 * Which ZeroFS instance serves which storage prefix.
 *
 * **v1 runs one ZeroFS per host**, so every volume placed here shares one prefix. That buys one
 * process, one local cache and one S3 client for the whole host, and it is the only shape whose
 * cost does not scale with tenant count.
 *
 * What it costs, stated plainly: the validated restore property — destroy a host, point a new
 * ZeroFS at the same bucket prefix, get the data back byte-identically — becomes per *host*
 * rather than per *app*. Moving one app to another host is then copying a device file between
 * two filesystems, not repointing at a prefix. A ZeroFS restart is also a fleet-wide event on
 * this host rather than one tenant's.
 *
 * The protocol already accommodates either shape, because `storagePrefix` is on the volume: a
 * per-host prefix simply means every volume on the host repeats it. Nothing below assumes one
 * filesystem — the volume path, the NBD socket and the admin RPC are all resolved *per volume*
 * from the prefix it names, so moving to one ZeroFS per app is a second factory here plus a
 * supervisor for the extra processes, not a rewrite of the volume manager.
 *
 * The invariant that holds under both: **exactly one read-write `zerofs run` per storage prefix,
 * fleet-wide.** ZeroFS does not reject a second writer — SlateDB's epoch fences the older one,
 * which then dies on its next durable write, after a window in which it has been acknowledging
 * writes that will be silently discarded. A duplicate is an outage, not an error message. The
 * agent therefore never starts ZeroFS; systemd's own single-instance guarantee is the lock.
 */
export class ZerofsTopology {
  readonly #filesystems: ZerofsFilesystem[];

  private constructor(filesystems: ZerofsFilesystem[]) {
    this.#filesystems = filesystems;
  }

  static sharedHostFilesystem({
    runner,
    storagePrefix,
    mountPath,
    nbdSocketPath,
    configFile,
  }: {
    runner: CommandRunner;
    storagePrefix: ObjectKey;
    mountPath: string;
    nbdSocketPath: string;
    configFile: string;
  }): ZerofsTopology {
    return new ZerofsTopology([
      {
        storagePrefix,
        mountPath,
        nbdSocketPath,
        configFile,
        admin: new ZerofsAdmin({ runner, configFile }),
      },
    ]);
  }

  /**
   * A volume naming a prefix this host does not serve is refused rather than written somewhere
   * else. Silently creating the device file in the wrong filesystem would put a tenant's data
   * under a prefix nothing will ever look for it under, which no later reconcile can undo.
   */
  resolve({ storagePrefix }: { storagePrefix: ObjectKey }): ZerofsFilesystem {
    const filesystem = this.#filesystems.find(
      (candidate) => candidate.storagePrefix === storagePrefix,
    );
    if (!filesystem) {
      throw new UnservedStoragePrefixError({
        storagePrefix,
        served: this.#filesystems.map((candidate) => candidate.storagePrefix),
      });
    }
    return filesystem;
  }

  all(): readonly ZerofsFilesystem[] {
    return this.#filesystems;
  }
}
