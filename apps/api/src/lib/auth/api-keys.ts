import { apiKey } from '@better-auth/api-key';
import { API_KEY_APP_PERMISSION, API_KEY_HEADER } from '@repo/api-constants';
import { AppIdSchema } from '@repo/protocol';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { NotFoundError } from '#lib/errors.ts';
import { isMalformedIdentifier } from '#lib/pg-errors.ts';
import type { AppsService } from '#services/apps.service.ts';

export type ApiKeyAppsServiceContract = {
  get(
    input: Parameters<AppsService['get']>[0],
  ): Promise<Pick<Awaited<ReturnType<AppsService['get']>>, 'id'>>;
};

export const ApiKeyAppIdsSchema = Type.Array(AppIdSchema, { minItems: 1, uniqueItems: true });
const ApiKeyMetadataSchema = Type.Object({ appIds: ApiKeyAppIdsSchema });

export function createApiKeyPlugin({ appsService }: { appsService: ApiKeyAppsServiceContract }) {
  return apiKey({
    apiKeyHeaders: API_KEY_HEADER,
    defaultPrefix: 'nib_',
    requireName: true,
    enableMetadata: true,
    rateLimit: { timeWindow: 60_000, maxRequests: 600 },
    permissions: {
      defaultPermissions: async function appPermissions(...[referenceId, context]) {
        if (!Value.Check(ApiKeyMetadataSchema, context.body.metadata)) {
          throw new APIError('BAD_REQUEST', { message: 'Select one or more apps for this key.' });
        }
        const { appIds } = Value.Parse(ApiKeyMetadataSchema, context.body.metadata);
        const ownerId = Value.Parse(OwnerIdSchema, referenceId);
        for (const appId of appIds) {
          try {
            await appsService.get({ appId, ownerId });
          } catch (error) {
            if (!(error instanceof NotFoundError) && !isMalformedIdentifier(error)) {
              throw error;
            }
            throw new APIError('FORBIDDEN', { message: 'Select only apps you own.' });
          }
        }
        return { [API_KEY_APP_PERMISSION]: appIds };
      },
    },
  });
}

// Keys authenticate app operations, but cannot mint credentials or change the owner's account.
export const apiKeyAccess = createAuthMiddleware(async (context) => {
  if (context.headers?.has(API_KEY_HEADER)) {
    throw new APIError('FORBIDDEN', { message: 'Sign in to manage your account and API keys.' });
  }
  if (context.path !== '/api-key/create') {
    return;
  }
  const session = await getSessionFromCtx(context);
  if (session?.user.isAnonymous === true) {
    throw new APIError('FORBIDDEN', { message: 'Sign in to create API keys.' });
  }
});
