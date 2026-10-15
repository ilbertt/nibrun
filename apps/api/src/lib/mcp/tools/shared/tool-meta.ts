import type { Tool } from '@modelcontextprotocol/server';
import { MCP_SCOPE } from '#lib/mcp/auth.ts';

export const MCP_TOOL_META = {
  securitySchemes: [{ type: 'oauth2', scopes: [MCP_SCOPE] }],
} as const satisfies NonNullable<Tool['_meta']>;
