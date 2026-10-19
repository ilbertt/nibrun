import { Type } from '@sinclair/typebox';
import { SECRET_ANNOTATION, secretString } from '#lib/secret.ts';
import { ObjectKeySchema } from '#lib/wire.ts';

const accessKeyProperties = {
  accessKeyId: secretString({ minLength: 1 }),
  secretAccessKey: secretString({ minLength: 1 }),
};

export const S3VolumeAuthSchema = Type.Union(
  [
    Type.Object(
      { kind: Type.Literal('access-key'), ...accessKeyProperties },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        kind: Type.Literal('session'),
        ...accessKeyProperties,
        sessionToken: secretString({ minLength: 1 }),
      },
      { additionalProperties: false },
    ),
    Type.Object({ kind: Type.Literal('anonymous') }, { additionalProperties: false }),
  ],
  // Invalid union variants must also stay redacted when validation fails.
  { [SECRET_ANNOTATION]: true },
);

export type S3VolumeAuth = typeof S3VolumeAuthSchema.static;

export const S3VolumeStorageSchema = Type.Object({
  endpoint: Type.String({ pattern: '^https://[^\\s]+$' }),
  bucket: Type.String({ pattern: '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$' }),
  prefix: ObjectKeySchema,
  region: Type.Optional(Type.String({ minLength: 1 })),
  auth: S3VolumeAuthSchema,
  encryptionPassword: secretString({ minLength: 1 }),
});

export type S3VolumeStorage = typeof S3VolumeStorageSchema.static;
