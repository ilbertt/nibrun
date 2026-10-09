import { AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { anonymous, bearer } from 'better-auth/plugins';
import { Elysia } from 'elysia';
import {
  type ApiKeyAppsServiceContract,
  apiKeyAccess,
  createApiKeyPlugin,
} from '#lib/auth/api-keys.ts';
import type { Auth } from '#lib/auth/better-auth.ts';
import {
  type ConnectionLookupServiceContract,
  createAuthPlugin,
  Identity,
} from '#lib/auth/plugin.ts';
import { elysiaErrorHandler, NotFoundError } from '#lib/errors.ts';

export const FIRST_APP = Value.Parse(AppIdSchema, 'first-app');
export const SECOND_APP = Value.Parse(AppIdSchema, 'second-app');
export const UNSELECTED_APP = Value.Parse(AppIdSchema, 'unselected-app');
export const FOREIGN_APP = Value.Parse(AppIdSchema, 'foreign-app');
export const APP_SCOPE = { appIds: [FIRST_APP] };

export function apiKeyAuth() {
  const database: Record<string, Record<string, unknown>[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
    apikey: [],
  };
  const appsService = {
    get({ appId, ownerId }: Parameters<ApiKeyAppsServiceContract['get']>[0]) {
      const owner = appId === FOREIGN_APP ? database.user?.[1] : database.user?.[0];
      if (
        ![FIRST_APP, SECOND_APP, UNSELECTED_APP, FOREIGN_APP].includes(appId) ||
        owner?.id !== ownerId
      ) {
        return Promise.reject(new NotFoundError());
      }
      return Promise.resolve({ id: appId });
    },
  };
  const sqliteService = {
    getConnection({
      id,
      ownerId,
    }: Parameters<ConnectionLookupServiceContract['getConnection']>[0]) {
      if (ownerId !== database.user?.[0]?.id) {
        return Promise.reject(new NotFoundError());
      }
      return Promise.resolve({ appId: id === 'first-connection' ? FIRST_APP : UNSELECTED_APP });
    },
  };
  const auth = betterAuth({
    baseURL: 'http://localhost',
    database: memoryAdapter(database),
    secret: 'tHLmzXWuP59zkV37DfNjC6YrABi2waEohGeSQLsO8RM',
    plugins: [bearer(), anonymous(), createApiKeyPlugin({ appsService })],
    hooks: { before: apiKeyAccess },
    logger: { disabled: true },
  });
  const app = new Elysia()
    .onError(elysiaErrorHandler)
    .use(createAuthPlugin({ auth: auth as unknown as Auth, sqliteService }))
    .get('/api/apps/:appId', ({ user }) => ({ id: user.id }), { auth: Identity.Required })
    .post('/api/apps/:appId/deployments', () => 'deployed', { auth: Identity.Required })
    .get('/api/apps', ({ appIds }) => ({ appIds }), { auth: Identity.Required })
    .post('/api/apps', () => 'created', { auth: Identity.Required })
    .get('/api/sqlite/connections/:connectionId', () => 'connection', { auth: Identity.Required })
    .post('/api/sqlite/connections/:connectionId/v2/pipeline', () => 'queried', {
      auth: Identity.Required,
    });
  return { auth, app, database };
}

type TestAuth = ReturnType<typeof apiKeyAuth>['auth'];

export async function member({ auth, email }: { auth: TestAuth; email: string }) {
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser(
    {
      name: 'Owner',
      email,
      emailVerified: true,
    },
    { method: 'test' },
  );
  const session = await context.internalAdapter.createSession(user.id);
  const headers = new Headers({ authorization: `Bearer ${session.token}` });
  return { user, headers };
}

export function ownerRequest(key: string) {
  return new Request(`http://localhost/api/apps/${FIRST_APP}`, { headers: { 'x-api-key': key } });
}
