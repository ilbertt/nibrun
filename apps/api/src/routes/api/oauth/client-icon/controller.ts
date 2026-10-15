import { Elysia, StatusMap } from 'elysia';
import { AuthCaller } from '#lib/auth/caller.ts';
import {
  GetOAuthClientIconQuerySchema,
  GetOAuthClientIconResponseSchema,
} from '#routes/api/oauth/client-icon/model.ts';
import { AuthPlugin, OAuthClientIconServicePlugin } from '#services/plugins.ts';

export const OAuthClientIconController = new Elysia()
  .use(AuthPlugin)
  .use(OAuthClientIconServicePlugin)
  .get(
    '/oauth/client-icon',
    async ({ oauthClientIconService, query, status }) =>
      status(StatusMap.OK, { iconUrl: await oauthClientIconService.discover(query) }),
    {
      auth: { policies: [AuthCaller.RegisteredAccount] },
      query: GetOAuthClientIconQuerySchema,
      response: { [StatusMap.OK]: GetOAuthClientIconResponseSchema },
      detail: { hide: true },
    },
  );
