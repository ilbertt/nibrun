import { Elysia } from 'elysia';
import { oauthDiscoveryResponse } from '#lib/auth/discovery.ts';
import { auth } from '#services/plugins.ts';

export const WellKnownOAuthAuthorizationServerController = new Elysia().all(
  '/.well-known/oauth-authorization-server',
  function authorizationServerMetadata({ request }) {
    return oauthDiscoveryResponse({ request, auth });
  },
  { parse: 'none', detail: { hide: true } },
);
