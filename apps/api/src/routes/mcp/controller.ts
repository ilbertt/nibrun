import { OwnerIdSchema, Value } from '@repo/protocol';
import { Elysia } from 'elysia';
import { authPlugin } from '#lib/auth/plugin.ts';
import { RoutePrefix } from '#lib/routes/prefixes.ts';
import { loggerPlugin, McpServicePlugin } from '#services/plugins.ts';

export const McpController = new Elysia()
  .use(loggerPlugin('mcpController'))
  .use(authPlugin)
  .use(McpServicePlugin)
  .guard({ auth: true })
  .all(
    RoutePrefix.Mcp,
    ({ mcpService, request, user }) =>
      mcpService.fetch({ request, ownerId: Value.Parse(OwnerIdSchema, user.id) }),
    // The mcp handler reads the body itself, and reads it as a stream, so Elysia must not have
    // consumed it first.
    { parse: 'none' },
  );
