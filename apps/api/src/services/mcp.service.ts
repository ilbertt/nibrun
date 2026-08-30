import type { McpHttpHandler } from '@modelcontextprotocol/server';
import type { InProcessApiClientOptions } from '@repo/api-client/public';
import { createInProcessPublicApiClient } from '@repo/api-client/public';
import { createNibrunMcpHandler } from '#lib/mcp/handler.ts';
import { Service } from '#services/service.ts';

/** The assembled server, as Eden takes one: Elysia's own generics, left as wide as it declares them. */
type Serving = InProcessApiClientOptions['app'];

const NOT_SERVING =
  'The mcp service was asked to answer before it had been given the server it dispatches through.';

/**
 * The MCP endpoint, as one fetch handler mounted at `/mcp`.
 *
 * The tools reach the api the way every other client does — through its public routes, carrying
 * the caller's own token — so nothing they can do is anything that caller could not have done
 * themselves. What differs from a CLI is only the journey: Eden dispatches an instance in
 * process, so the request never reaches a socket.
 */
export class McpService extends Service {
  readonly #handler: McpHttpHandler;
  #serving: Serving | undefined;

  constructor() {
    super();
    this.#handler = createNibrunMcpHandler({
      apiFor: ({ token }) =>
        createInProcessPublicApiClient({
          app: this.serving(),
          headers: { authorization: `Bearer ${token}` },
        }),
    });
  }

  /**
   * The server the tools dispatch through, handed over once it exists.
   *
   * Late rather than injected, because the two are circular by construction: this service is built
   * into the very app it goes on to make requests of. Nothing reads it until a request arrives, by
   * which time the app is long since assembled.
   */
  serves(app: Serving): void {
    this.#serving = app;
  }

  fetch({ request, token }: { request: Request; token: string }): Promise<Response> {
    // The whole of what the mcp server is told about the caller. It verifies nothing itself — the
    // route above has already done that — and uses the token to act as them and nothing else.
    return this.#handler.fetch(request, {
      authInfo: { token, clientId: '', scopes: [] },
    });
  }

  private serving(): Serving {
    if (this.#serving === undefined) {
      throw new Error(NOT_SERVING);
    }
    return this.#serving;
  }
}
