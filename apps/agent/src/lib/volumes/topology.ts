import type { ObjectKey } from '@repo/protocol';
import type { ZerofsAdmin } from '#lib/volumes/zerofs.ts';

/**
 * One ZeroFS filesystem is one `[storage] url` prefix. A device file lives inside a filesystem,
 * so the prefix a volume names decides which ZeroFS serves it.
 *
 * `mountPath` is the host's own mount, where `.nbd/<volume-id>` is created and sized. What that
 * file contains is an image the host never asks its kernel to interpret.
 *
 * `checkpointRuntimeDir` holds a directory per checkpoint server, each with an NBD socket of its
 * own. Separate from `nbdSocketPath` because a checkpoint is served by a second process: sharing
 * the live server's socket path would be two listeners fighting over one address.
 */
export type ZerofsFilesystem = {
  readonly storagePrefix: ObjectKey;
  readonly mountPath: string;
  readonly nbdSocketPath: string;
  readonly checkpointRuntimeDir: string;
  readonly admin: ZerofsAdmin;
};
