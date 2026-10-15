import { Elysia } from 'elysia';
import { AUTH_ROUTE_PATH } from '#lib/auth/paths.ts';
import { auth, McpAnalyticsServicePlugin } from '#services/plugins.ts';

// better-auth owns every path under its base path and reads the request itself,
// so Elysia must not consume the body before handing it over.
export const AuthController = new Elysia()
  .use(McpAnalyticsServicePlugin)
  .all(
    `${AUTH_ROUTE_PATH}/*`,
    ({ request, mcpAnalyticsService }) =>
      mcpAnalyticsService.handleAuth({ request, handler: auth.handler }),
    { parse: 'none' },
  );
