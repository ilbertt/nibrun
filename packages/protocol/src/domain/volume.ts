import { Type } from '@sinclair/typebox';
import { AppIdSchema, VolumeIdSchema } from '#domain/identifiers.ts';
import { stringEnum } from '#lib/string-enum.ts';
import { ByteSizeSchema, ObjectKeySchema, TimestampSchema } from '#lib/wire.ts';

// `deleted` is reported once the filesystem is actually gone, which is what lets the control
// plane finish deleting an app rather than leave it saying `deleting` forever.
export const VOLUME_STATES = ['pending', 'ready', 'detached', 'deleted', 'failed'] as const;

export const VolumeStateSchema = stringEnum(VOLUME_STATES);

export type VolumeState = typeof VolumeStateSchema.static;

export const VolumeSchema = Type.Object({
  id: VolumeIdSchema,
  appId: AppIdSchema,
  sizeBytes: ByteSizeSchema,
  // The filesystem's durable identity. S3 is the source of truth and a host's local disk is a
  // disposable cache, so restoring an app elsewhere is pointing a new ZeroFS instance at this
  // prefix — which is why it belongs to the volume rather than to the host holding it.
  storagePrefix: ObjectKeySchema,
  state: VolumeStateSchema,
  createdAt: TimestampSchema,
});

export type Volume = typeof VolumeSchema.static;
