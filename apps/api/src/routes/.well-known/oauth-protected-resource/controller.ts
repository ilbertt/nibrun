import { Elysia } from 'elysia';
import { oauthDiscoveryResponse } from '#lib/auth/discovery.ts';
import { auth } from '#services/plugins.ts';

export const WellKnownOAuthProtectedResourceController = new Elysia().all(
  '/.well-known/oauth-protected-resource',
  function protectedResourceMetadata({ request }) {
    return oauthDiscoveryResponse({ request, auth });
  },
  { parse: 'none', detail: { hide: true } },
);
