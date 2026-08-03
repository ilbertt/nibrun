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

export class NoFilesystemError extends Error {
  constructor() {
    super('This host serves no ZeroFS filesystem, so it can hold no volume');
    this.name = 'NoFilesystemError';
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
 * The protocol accommodates either shape, because where a volume went is reported rather than
 * instructed: a per-host filesystem simply means every volume on it reports the same prefix.
 * Nothing below assumes one filesystem — the volume path, the NBD socket and the admin RPC are
 * all resolved from the filesystem a volume was placed in, so moving to one ZeroFS per app is a
 * second factory here plus a supervisor for the extra processes, not a rewrite of the manager.
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
   * Which filesystem a volume belongs in. One per host in v1, so nothing is being chosen — but
   * choosing here is what makes a second shape a policy rather than a protocol change.
   */
  place(): ZerofsFilesystem {
    const [filesystem] = this.#filesystems;
    if (!filesystem) {
      throw new NoFilesystemError();
    }
    return filesystem;
  }

  all(): readonly ZerofsFilesystem[] {
    return this.#filesystems;
  }
}
