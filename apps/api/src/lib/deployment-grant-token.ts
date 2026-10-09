import { createHash, randomBytes } from 'node:crypto';
import { Value } from '@sinclair/typebox/value';
import { DeploymentGrantTokenSchema } from '#lib/api/deployment-grant.ts';
import { type OwnerId, OwnerIdSchema } from '#lib/api/identifiers.ts';
import {
  DEPLOYMENT_GRANT_SECRET_BYTES,
  DEPLOYMENT_GRANT_TOKEN_PREFIX,
} from '#lib/deployment-grant-policy.ts';

export function createDeploymentGrantToken({ ownerId }: { ownerId: OwnerId }): string {
  const secret = randomBytes(DEPLOYMENT_GRANT_SECRET_BYTES).toString('base64url');
  return `${DEPLOYMENT_GRANT_TOKEN_PREFIX}${ownerId}.${secret}`;
}

export function deploymentGrantTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function deploymentGrantTokenOwner(token: string): OwnerId {
  Value.Assert(DeploymentGrantTokenSchema, token);
  // The owner only routes the lookup; the hash of the entire token establishes authorization.
  const [ownerId] = token.slice(DEPLOYMENT_GRANT_TOKEN_PREFIX.length).split('.');
  Value.Assert(OwnerIdSchema, ownerId);
  return ownerId;
}
