import { Elysia } from 'elysia';
import { auth } from '#services/plugins.ts';

export const WellKnownOAuthAuthorizationServerController = new Elysia().all(
  '/.well-known/oauth-authorization-server',
  function authorizationServerMetadata({ request }) {
    return auth.handler(request);
  },
  { parse: 'none', detail: { hide: true } },
);
