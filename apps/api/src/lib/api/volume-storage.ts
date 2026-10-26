import { S3VolumeAuthSchema, S3VolumeStorageSchema } from '@repo/protocol';
import { Type } from '@sinclair/typebox';

export const CreateVolumeStorageSchema = Type.Omit(S3VolumeStorageSchema, ['prefix'], {
  additionalProperties: false,
});
export type CreateVolumeStorage = typeof CreateVolumeStorageSchema.static;

export const VolumeStorageMetadataSchema = Type.Composite([
  Type.Omit(S3VolumeStorageSchema, ['auth', 'encryptionPassword']),
  Type.Object({ auth: Type.Pick(S3VolumeAuthSchema, ['kind']) }),
]);
export type VolumeStorageMetadata = typeof VolumeStorageMetadataSchema.static;
