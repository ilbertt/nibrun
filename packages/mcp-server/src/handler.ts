import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import type { PublicApiClient } from '@repo/api-client/public';
import { createNibrunMcpServer } from '#server.ts';

const NOT_VERIFIED =
  'The mcp handler was reached without an authenticated caller. Whatever mounts it verifies the bearer token and passes authInfo.';

/**
 * How a verified caller becomes a client that acts as them.
 *
 * Supplied by whatever mounts this rather than built here: the token is the whole of what this
 * package knows about a caller, and where the api it talks to lives — another origin, or the same
 * process — is the mount's business.
 */
export type ApiForCaller = (input: { token: string }) => PublicApiClient;

/**
 * The MCP endpoint as a fetch handler.
 *
 * It verifies nothing. The SDK treats `authInfo` as strictly pass-through — it never reads a
 * header or checks a token — so the mount is what answers an unauthenticated request, and by the
 * time this is called the caller is already known.
 */
export function createNibrunMcpHandler({ apiFor }: { apiFor: ApiForCaller }): McpHttpHandler {
  return createMcpHandler((context) => {
    const token = context.authInfo?.token;
    if (token === undefined) {
      throw new Error(NOT_VERIFIED);
    }
    return createNibrunMcpServer({ api: apiFor({ token }) });
  });
}
