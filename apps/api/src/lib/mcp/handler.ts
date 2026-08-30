import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import { type OwnerId, OwnerIdSchema, Value } from '@repo/protocol';
import { createNibrunMcpServer } from '#lib/mcp/server.ts';
import type { McpServices } from '#lib/mcp/services.ts';

const NOT_VERIFIED =
  'The mcp handler was reached without an authenticated caller. Whatever mounts it verifies the request and says which owner it authenticated as.';

/** What the route that mounts this has already established about the caller. */
export type McpCaller = { ownerId: OwnerId };

/**
 * The MCP endpoint as a fetch handler.
 *
 * It verifies nothing. The SDK treats `authInfo` as strictly pass-through — it never reads a
 * header or checks a token — so the route that mounts this is what answers an unauthenticated
 * request, and by the time this is called the caller is already known.
 */
export function createNibrunMcpHandler({ services }: { services: McpServices }): McpHttpHandler {
  return createMcpHandler((context) => {
    const owner = context.authInfo?.extra?.ownerId;
    if (typeof owner !== 'string') {
      throw new Error(NOT_VERIFIED);
    }
    return createNibrunMcpServer({ services, ownerId: Value.Parse(OwnerIdSchema, owner) });
  });
}
