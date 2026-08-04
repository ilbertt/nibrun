import type { ObjectKey } from '@repo/protocol';
import type { ZerofsAdmin } from '#lib/volumes/zerofs.ts';

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
