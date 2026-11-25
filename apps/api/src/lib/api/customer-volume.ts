import { S3VolumeStorageSchema } from '@repo/protocol';
import { Type } from '@sinclair/typebox';

export const VolumeStorageLocationSchema = Type.Pick(S3VolumeStorageSchema, ['bucket', 'prefix']);
export type VolumeStorageLocation = typeof VolumeStorageLocationSchema.static;
