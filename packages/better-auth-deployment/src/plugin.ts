import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint, createAuthMiddleware } from 'better-auth/api';
import { parseAccessTokenAuthorization } from 'better-auth/oauth2';
import { z } from 'zod';
import { DEPLOYMENT_TOKEN_CONFIG_ID, DEPLOYMENT_TOKEN_PERMISSION } from '#configuration.ts';

const MS_PER_SECOND = 1000;
const ISSUANCE_MARGIN_SECONDS = 1;
const IdentifierSchema = z.string().min(1);
const GrantReferenceSchema = z.object({ grantId: IdentifierSchema });

export function deploymentTokens() {
  return {
    id: 'deployment-tokens',
    hooks: {
      before: [
        {
          matcher(context) {
            return (
              (context.path === '/api-key/create' || context.path === '/api-key/update') &&
              context.body?.configId === DEPLOYMENT_TOKEN_CONFIG_ID
            );
          },
          handler: createAuthMiddleware(function protectDeploymentCredentials(context) {
            if (context.request || context.headers) {
              throw new APIError('FORBIDDEN', {
                message: 'Deployment credentials can only be issued and updated by the server.',
              });
            }
            return Promise.resolve();
          }),
        },
      ],
    },
    endpoints: {
      issueDeploymentToken: createAuthEndpoint.serverOnly(
        {
          method: 'POST',
          body: z.object({
            ownerId: IdentifierSchema,
            appId: IdentifierSchema,
            grantId: IdentifierSchema,
            expiresAt: z.date(),
          }),
        },
        async function issueDeploymentToken(ctx) {
          const expiresIn =
            Math.floor((ctx.body.expiresAt.getTime() - Date.now()) / MS_PER_SECOND) -
            ISSUANCE_MARGIN_SECONDS;
          if (expiresIn <= 0) {
            throw new APIError('UNAUTHORIZED', { message: 'The deployment grant has expired.' });
          }
          const apiKeys = ctx.context.getPlugin('api-key');
          if (!apiKeys) {
            throw new APIError('INTERNAL_SERVER_ERROR', {
              message: 'Deployment credentials require the API Key plugin.',
            });
          }
          const credential = await apiKeys.endpoints.createApiKey({
            context: ctx.context,
            body: {
              configId: DEPLOYMENT_TOKEN_CONFIG_ID,
              userId: ctx.body.ownerId,
              expiresIn,
              permissions: { [ctx.body.appId]: [DEPLOYMENT_TOKEN_PERMISSION] },
              metadata: { grantId: ctx.body.grantId },
            },
          });
          if (
            !credential.expiresAt ||
            credential.expiresAt.getTime() > ctx.body.expiresAt.getTime()
          ) {
            throw new APIError('INTERNAL_SERVER_ERROR', {
              message: 'Deployment credentials must expire within their grant lifetime.',
            });
          }
          return { token: credential.key, expiresAt: credential.expiresAt };
        },
      ),
      authenticateDeploymentToken: createAuthEndpoint.serverOnly(
        {
          method: 'POST',
          requireHeaders: true,
          body: z.object({ appId: IdentifierSchema }),
        },
        async function authenticateDeploymentToken(ctx) {
          const authorization = parseAccessTokenAuthorization(ctx.headers.get('authorization'));
          if (authorization?.scheme !== 'Bearer') {
            throw new APIError('UNAUTHORIZED', {
              message: 'A deployment Bearer token is required.',
            });
          }
          const apiKeys = ctx.context.getPlugin('api-key');
          if (!apiKeys) {
            throw new APIError('INTERNAL_SERVER_ERROR', {
              message: 'Deployment credentials require the API Key plugin.',
            });
          }
          const verification = await apiKeys.endpoints.verifyApiKey({
            context: ctx.context,
            body: {
              configId: DEPLOYMENT_TOKEN_CONFIG_ID,
              key: authorization.token,
              permissions: { [ctx.body.appId]: [DEPLOYMENT_TOKEN_PERMISSION] },
            },
          });
          if (!verification.valid || !verification.key?.expiresAt) {
            throw new APIError('UNAUTHORIZED', { message: 'Invalid or expired deployment token.' });
          }
          const grant = GrantReferenceSchema.safeParse(verification.key.metadata);
          if (!grant.success) {
            throw new APIError('UNAUTHORIZED', { message: 'The deployment token has no grant.' });
          }
          return {
            ownerId: verification.key.referenceId,
            appId: ctx.body.appId,
            grantId: grant.data.grantId,
            expiresAt: verification.key.expiresAt,
          };
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
