import { Type } from '@sinclair/typebox';
import { secretString } from '#lib/secret.ts';
import { ObjectKeySchema } from '#lib/wire.ts';

export const S3VolumeStorageSchema = Type.Object({
  kind: Type.Literal('s3'),
  endpoint: Type.String({ pattern: '^https://[^\\s]+$' }),
  bucket: Type.String({ pattern: '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$' }),
  prefix: ObjectKeySchema,
  region: Type.Optional(Type.String({ minLength: 1 })),
  accessKeyId: secretString({ minLength: 1 }),
  secretAccessKey: secretString({ minLength: 1 }),
  sessionToken: Type.Optional(secretString({ minLength: 1 })),
  encryptionPassword: secretString({ minLength: 1 }),
});

export type S3VolumeStorage = typeof S3VolumeStorageSchema.static;
