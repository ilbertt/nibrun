import { Elysia } from 'elysia';
import { authPlugin } from '#lib/auth/plugin.ts';
import { UnauthorizedError } from '#lib/errors.ts';
import { RoutePrefix } from '#lib/routes/prefixes.ts';
import { loggerPlugin, McpServicePlugin } from '#services/plugins.ts';

const BEARER = 'Bearer ';

export const McpController = new Elysia()
  .use(loggerPlugin('mcpController'))
  .use(authPlugin)
  .use(McpServicePlugin)
  .guard({ auth: true })
  .all(
    RoutePrefix.Mcp,
    ({ mcpService, request }) => mcpService.fetch({ request, token: bearer(request) }),
    // The mcp handler reads the body itself, and reads it as a stream, so Elysia must not have
    // consumed it first.
    { parse: 'none' },
  );

/**
 * The token the caller authenticated with, to act as them through the api's own routes.
 *
 * A cookie is refused rather than accommodated: MCP clients carry a bearer, and a session this end
 * cannot hand onward is one whose requests would go out as nobody.
 */
function bearer(request: Request): string {
  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.startsWith(BEARER)) {
    throw new UnauthorizedError();
  }
  return authorization.slice(BEARER.length);
}
