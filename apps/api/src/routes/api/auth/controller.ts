import { Elysia } from 'elysia';
import { AUTH_ROUTE_PATH, auth } from '#lib/auth.ts';

const AUTH_ROUTE = `${AUTH_ROUTE_PATH}/*`;

// better-auth reads the request itself, so Elysia must not consume the body first.
//
// Registered per method rather than with `all`: the dashboard's SPA fallback is a
// `GET *`, and a route bound to one method outranks a wildcard method, so an
// `all` here would lose every GET under this path to that fallback.
const handle = ({ request }: { request: Request }) => auth.handler(request);

export const AuthController = new Elysia()
  .get(AUTH_ROUTE, handle, { parse: 'none' })
  .post(AUTH_ROUTE, handle, { parse: 'none' });
