import type { McpHttpHandler } from '@modelcontextprotocol/server';
import type { OwnerId } from '@repo/protocol';
import { createNibrunMcpHandler } from '#lib/mcp/handler.ts';
import type { McpServices } from '#lib/mcp/services.ts';
import { Service } from '#services/service.ts';

/**
 * The MCP endpoint, as one fetch handler mounted at `/mcp`.
 *
 * The tools call the same services every controller calls, scoped to the owner the route
 * authenticated — so a tool reaches exactly what that caller could reach and nothing else.
 */
export class McpService extends Service {
  readonly #handler: McpHttpHandler;

  constructor(services: McpServices) {
    super();
    this.#handler = createNibrunMcpHandler({ services });
  }

  fetch({ request, ownerId }: { request: Request; ownerId: OwnerId }): Promise<Response> {
    // `authInfo` is the only thing the sdk carries from here into a tool, and the whole of what
    // this end has to say about the caller: who they are. There is no token to pass on, because
    // nothing downstream authenticates anything again.
    return this.#handler.fetch(request, {
      authInfo: { token: '', clientId: '', scopes: [], extra: { ownerId } },
    });
  }
}
