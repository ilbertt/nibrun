import { publicSchema } from '@repo/typebox-extensions';
import { t } from 'elysia';
import {
  DeployKeyNameSchema,
  DeployKeySchema,
  DeployPublicKeySchema,
} from '#lib/api/deploy-key.ts';

export const AddDeployKeyBodySchema = t.Object(
  { name: DeployKeyNameSchema, publicKey: DeployPublicKeySchema },
  { additionalProperties: false },
);

export const DeployKeyResponseSchema = publicSchema(DeployKeySchema);
export const ListDeployKeysResponseSchema = t.Object({
  deployKeys: t.Array(DeployKeyResponseSchema),
});
