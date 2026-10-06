import {
  AppIdSchema,
  ByteSizeSchema,
  ObjectKeySchema,
  TimestampSchema,
  VolumeIdSchema,
  VolumeStateSchema,
} from '@repo/protocol';
import { Type } from '@sinclair/typebox';

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
