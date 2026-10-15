import { Elysia } from 'elysia';
import { MCP_RESOURCE_METADATA_PATH } from '#lib/mcp/auth.ts';
import { auth } from '#services/plugins.ts';

export const WellKnownOAuthProtectedResourceMcpController = new Elysia().all(
  MCP_RESOURCE_METADATA_PATH,
  function protectedResourceMetadata({ request }) {
    return auth.handler(request);
  },
  { parse: 'none', detail: { hide: true } },
);
