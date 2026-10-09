import { TimestampSchema } from '@repo/protocol';
import { type Static, Type } from '@sinclair/typebox';
import { DeploymentGrantIdSchema, OwnerIdSchema } from '#lib/api/identifiers.ts';
import {
  DEPLOYMENT_GRANT_SECRET_BYTES,
  DEPLOYMENT_GRANT_TOKEN_PREFIX,
} from '#lib/deployment-grant-policy.ts';

const BITS_PER_BYTE = 8;
const BASE64URL_BITS_PER_CHARACTER = 6;
const secretLength = Math.ceil(
  (DEPLOYMENT_GRANT_SECRET_BYTES * BITS_PER_BYTE) / BASE64URL_BITS_PER_CHARACTER,
);
const ownerPattern = OwnerIdSchema.pattern?.slice(1, -1);

export const DeploymentGrantTokenSchema = Type.String({
  pattern: `^${DEPLOYMENT_GRANT_TOKEN_PREFIX}${ownerPattern}[.][A-Za-z0-9_-]{${secretLength}}$`,
  maxLength:
    DEPLOYMENT_GRANT_TOKEN_PREFIX.length + (OwnerIdSchema.maxLength ?? 0) + 1 + secretLength,
});

export const DeploymentGrantSchema = Type.Object({
  id: DeploymentGrantIdSchema,
  token: DeploymentGrantTokenSchema,
  expiresAt: TimestampSchema,
});

export type DeploymentGrant = Static<typeof DeploymentGrantSchema>;
