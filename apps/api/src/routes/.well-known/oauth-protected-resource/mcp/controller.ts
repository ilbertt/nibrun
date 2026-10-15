import { Elysia } from 'elysia';
import { MCP_RESOURCE_METADATA, MCP_RESOURCE_METADATA_PATH } from '#lib/mcp.ts';

export const WellKnownOAuthProtectedResourceMcpController = new Elysia().get(
  MCP_RESOURCE_METADATA_PATH,
  function protectedResourceMetadata() {
    return MCP_RESOURCE_METADATA;
  },
);
