import { S3VolumeStorageSchema } from '@repo/protocol';
import { Type } from '@sinclair/typebox';

export const CustomerVolumeInputSchema = Type.Omit(S3VolumeStorageSchema, ['prefix'], {
  additionalProperties: false,
  description:
    'Use an existing S3-compatible bucket for this app. nibrun assigns the prefix. On an existing app the next deployment applies the change and migrates shared data, with downtime for the copy.',
});
export type CustomerVolumeInput = typeof CustomerVolumeInputSchema.static;

export const VolumeStorageLocationSchema = Type.Pick(S3VolumeStorageSchema, ['bucket', 'prefix']);
export type VolumeStorageLocation = typeof VolumeStorageLocationSchema.static;
