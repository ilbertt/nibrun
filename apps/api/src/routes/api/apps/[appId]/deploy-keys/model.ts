import { DeployKeyNameSchema, DeployKeySchema, DeployPublicKeySchema } from '@repo/protocol';
import { t } from 'elysia';

export const AddDeployKeyBodySchema = t.Object(
  { name: DeployKeyNameSchema, publicKey: DeployPublicKeySchema },
  { additionalProperties: false },
);

export const ListDeployKeysResponseSchema = t.Object({ deployKeys: t.Array(DeployKeySchema) });
