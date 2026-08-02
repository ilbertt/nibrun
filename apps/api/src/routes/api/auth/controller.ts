import { Elysia } from 'elysia';
import { AUTH_ROUTE_PATH, auth } from '#lib/auth/better-auth.ts';

// better-auth owns every path under its base path and reads the request itself,
// so Elysia must not consume the body before handing it over.
export const AuthController = new Elysia().all(
  `${AUTH_ROUTE_PATH}/*`,
  ({ request }) => auth.handler(request),
  { parse: 'none' },
);
