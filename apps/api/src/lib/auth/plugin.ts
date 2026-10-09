import { API_KEY_APP_PERMISSION, API_KEY_HEADER } from '@repo/api-constants';
import type { AppId } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import Elysia from 'elysia';
import { OwnerIdSchema, SqliteConnectionIdSchema } from '#lib/api/identifiers.ts';
import { ApiKeyAppIdsSchema } from '#lib/auth/api-keys.ts';
import type { Auth } from '#lib/auth/better-auth.ts';
import { ForbiddenError, TooManyRequestsError, UnauthorizedError } from '#lib/errors.ts';
import { RoutePrefix } from '#lib/routes/prefixes.ts';
import type { SqliteService } from '#services/sqlite.service.ts';

export type ConnectionLookupServiceContract = {
  getConnection(
    input: Parameters<SqliteService['getConnection']>[0],
  ): Promise<Pick<Awaited<ReturnType<SqliteService['getConnection']>>, 'appId'>>;
};
type AuthPluginInput = { auth: Auth; sqliteService: ConnectionLookupServiceContract };

async function requestIdentity({ auth, request }: { auth: Auth; request: Request }) {
  if (request.headers.has(API_KEY_HEADER)) {
    return await apiKeyIdentity({ auth, key: request.headers.get(API_KEY_HEADER) ?? '' });
  }
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    throw new UnauthorizedError();
  }
  return { user: session.user, appIds: undefined };
}

async function apiKeyIdentity({ auth, key }: { auth: Auth; key: string }) {
  if (!key.trim()) {
    throw new UnauthorizedError('Invalid or expired API key.');
  }
  const verified = await auth.api.verifyApiKey({ body: { key } });
  if (!verified.valid || !verified.key) {
    if (verified.error?.code === 'RATE_LIMITED') {
      throw new TooManyRequestsError();
    }
    throw new UnauthorizedError('Invalid or expired API key.');
  }
  const permitted = verified.key.permissions?.[API_KEY_APP_PERMISSION];
  if (!Value.Check(ApiKeyAppIdsSchema, permitted)) {
    throw new ForbiddenError('This API key has no app access.');
  }
  const appIds = Value.Parse(ApiKeyAppIdsSchema, permitted);
  const context = await auth.$context;
  const user = await context.internalAdapter.findUserById(verified.key.referenceId);
  if (!user) {
    throw new UnauthorizedError();
  }
  if ('isAnonymous' in user && user.isAnonymous === true) {
    throw new ForbiddenError('Sign in to use API keys.');
  }
  return { user: { ...user, isAnonymous: false }, appIds };
}

async function assertAppScope({
  request,
  params,
  appIds,
  ownerId,
  sqliteService,
}: {
  request: Request;
  params: Record<string, string>;
  appIds: readonly AppId[] | undefined;
  ownerId: string;
  sqliteService: ConnectionLookupServiceContract;
}): Promise<void> {
  if (appIds === undefined) {
    return;
  }
  if (request.method === 'GET' && new URL(request.url).pathname === `${RoutePrefix.Api}/apps`) {
    return;
  }
  const appId = await requestedApp({ params, ownerId, sqliteService });
  if (appId === undefined || !appIds.some((permitted) => permitted === appId)) {
    throw new ForbiddenError('This API key cannot access this app.');
  }
}

async function requestedApp({
  params,
  ownerId,
  sqliteService,
}: {
  params: Record<string, string>;
  ownerId: string;
  sqliteService: ConnectionLookupServiceContract;
}): Promise<string | undefined> {
  if (params.appId !== undefined) {
    return params.appId;
  }
  if (params.connectionId !== undefined) {
    const connection = await sqliteService.getConnection({
      id: Value.Parse(SqliteConnectionIdSchema, params.connectionId),
      ownerId: Value.Parse(OwnerIdSchema, ownerId),
    });
    return connection.appId;
  }
  return undefined;
}

export enum Identity {
  Optional = 'optional',
  Required = 'required',
}

export function createAuthPlugin({ auth, sqliteService }: AuthPluginInput) {
  return new Elysia({ name: 'auth' }).macro({
    auth: (identity: Identity) => ({
      async resolve({ request, params = {} }) {
        const authenticated = await requestIdentity({ auth, request });
        const user = {
          ...authenticated.user,
          isAnonymous: authenticated.user.isAnonymous === true,
        };
        if (identity === Identity.Required && user.isAnonymous) {
          throw new ForbiddenError('Sign in to do this.');
        }
        await assertAppScope({
          request,
          params,
          appIds: authenticated.appIds,
          ownerId: user.id,
          sqliteService,
        });
        return { user, appIds: authenticated.appIds };
      },
    }),
  });
}
