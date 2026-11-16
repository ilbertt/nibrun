import { Type } from '@sinclair/typebox';
import { Sha256DigestSchema } from '#lib/wire.ts';

const ImagePathSchema = Type.String({
  minLength: 1,
  maxLength: 4096,
  pattern: '^/[^\\u0000]*$',
});

export const OciImageSchema = Type.Object({
  kind: Type.Literal('oci'),
  repository: Type.String({
    minLength: 1,
    maxLength: 255,
    pattern:
      '^[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[0-9]{1,5})?/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?(?:/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)*$',
    description: 'Registry hostname and full repository path, without a scheme, tag or digest.',
  }),
  digest: Sha256DigestSchema,
  program: ImagePathSchema,
  workingDirectory: ImagePathSchema,
});

export type OciImage = typeof OciImageSchema.static;
