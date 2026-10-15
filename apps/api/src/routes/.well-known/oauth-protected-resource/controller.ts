import { Elysia } from 'elysia';
import { auth } from '#services/plugins.ts';

export const WellKnownOAuthProtectedResourceController = new Elysia().all(
  '/.well-known/oauth-protected-resource',
  function protectedResourceMetadata({ request }) {
    return auth.handler(request);
  },
  { parse: 'none', detail: { hide: true } },
);
