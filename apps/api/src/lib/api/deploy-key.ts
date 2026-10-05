import { AppIdSchema, TimestampSchema } from '@repo/protocol';
import { Type } from '@sinclair/typebox';
import { DeployKeyIdSchema } from '#lib/api/identifiers.ts';

export const DeployKeyNameSchema = Type.String({ minLength: 1, maxLength: 100, pattern: '\\S' });
export const DeployPublicKeySchema = Type.String({ minLength: 1, maxLength: 1024 });

export const DeployKeySchema = Type.Object({
  id: DeployKeyIdSchema,
  appId: AppIdSchema,
  name: DeployKeyNameSchema,
  publicKey: DeployPublicKeySchema,
  fingerprint: Type.String(),
  createdAt: TimestampSchema,
});

export type DeployKey = typeof DeployKeySchema.static;
