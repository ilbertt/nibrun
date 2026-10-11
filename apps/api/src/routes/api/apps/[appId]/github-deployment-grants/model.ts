import { AppIdSchema } from '@repo/protocol';
import { Type } from '@sinclair/typebox';
import { DeploymentGrantSchema } from '#lib/api/deployment-grant.ts';
import { GITHUB_IDENTITY_TOKEN_MAX_LENGTH } from '#lib/deployment-grant-policy.ts';

export const ExchangeGitHubDeploymentGrantParamsSchema = Type.Object({ appId: AppIdSchema });
export const ExchangeGitHubDeploymentGrantRequestSchema = Type.Object(
  { identityToken: Type.String({ minLength: 1, maxLength: GITHUB_IDENTITY_TOKEN_MAX_LENGTH }) },
  { additionalProperties: false },
);
export const ExchangeGitHubDeploymentGrantResponseSchema = DeploymentGrantSchema;
