import { S3VolumeStorageSchema } from '@repo/protocol';
import { Type } from '@sinclair/typebox';

export const CustomerVolumeSchema = Type.Object(
  {
    ...Type.Omit(S3VolumeStorageSchema, ['prefix', 'region']).properties,
    region: Type.Union([S3VolumeStorageSchema.properties.region, Type.Null()]),
  },
  { additionalProperties: false },
);
export type CustomerVolume = typeof CustomerVolumeSchema.static;
