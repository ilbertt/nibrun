import type { ObjectKey, S3VolumeStorage } from '@repo/protocol';
import type { ZerofsAdmin } from '#lib/volumes/zerofs.ts';

/**
 * The prefix is relative to the backend in `admin.configFile`, not a global identity:
 * different buckets may contain the same prefix.
 *
 * `mountPath` is the host's own mount, where `.nbd/<volume-id>` is created and sized. What that
 * file contains is an image the host never asks its kernel to interpret.
 */
export type ZerofsLiveFilesystem = {
  readonly storagePrefix: ObjectKey;
  readonly mountPath: string;
  readonly nbdSocketPath: string;
  readonly admin: ZerofsAdmin;
};

export type AppZerofsRegistration = {
  readonly filesystem: ZerofsLiveFilesystem;
  readonly storage: S3VolumeStorage;
};

/**
 * `checkpointRuntimeDir` holds a directory per checkpoint server, each with an NBD socket of its
 * own. Separate from `nbdSocketPath` because a checkpoint is served by a second process: sharing
 * the live server's socket path would be two listeners fighting over one address.
 */
export type ZerofsFilesystem = ZerofsLiveFilesystem & {
  readonly checkpointRuntimeDir: string;
};
