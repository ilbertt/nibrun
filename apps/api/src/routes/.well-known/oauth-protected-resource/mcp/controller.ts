import { Elysia } from 'elysia';
import { oauthDiscoveryResponse } from '#lib/auth/discovery.ts';
import { MCP_RESOURCE_METADATA_PATH } from '#lib/mcp.ts';
import { auth } from '#services/plugins.ts';

export const WellKnownOAuthProtectedResourceMcpController = new Elysia().all(
  MCP_RESOURCE_METADATA_PATH,
  function protectedResourceMetadata({ request }) {
    return oauthDiscoveryResponse({ request, auth });
  },
  { parse: 'none', detail: { hide: true } },
);
