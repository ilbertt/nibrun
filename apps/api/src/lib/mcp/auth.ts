import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/server';
import { Type } from '@sinclair/typebox';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { OAUTH_ISSUER } from '#lib/auth/oauth-issuer.ts';
import { RoutePrefix } from '#lib/routes/prefixes.ts';

export const MCP_RESOURCE = new URL(RoutePrefix.Mcp, OAUTH_ISSUER);
export const MCP_RESOURCE_METADATA_URL = getOAuthProtectedResourceMetadataUrl(MCP_RESOURCE);
export const MCP_RESOURCE_METADATA_PATH = new URL(MCP_RESOURCE_METADATA_URL).pathname;

export const MCP_SCOPE = 'mcp';

export const McpAccessTokenClaimsSchema = Type.Object({
  sub: OwnerIdSchema,
  client_id: Type.String({ minLength: 1 }),
  scope: Type.String(),
  exp: Type.Integer(),
  iat: Type.Integer(),
});
