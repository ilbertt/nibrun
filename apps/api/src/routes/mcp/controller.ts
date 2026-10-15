import { createMcpProtectedRequestHandler } from '@better-auth/mcp';
import {
  hostHeaderValidationResponse,
  originValidationResponse,
} from '@modelcontextprotocol/server';
import { createDpopReplayStore } from 'better-auth/oauth2';
import { Elysia } from 'elysia';
import { OAUTH_ISSUER, OAUTH_JWKS_URL } from '#lib/auth/oauth-issuer.ts';
import { env } from '#lib/env.ts';
import { MCP_RESOURCE, MCP_SCOPE, McpAccessTokenClaimsSchema } from '#lib/mcp/auth.ts';
import { createMcpServerHandler } from '#lib/mcp/server.ts';
import { RoutePrefix } from '#lib/routes/prefixes.ts';
import {
  AppsServicePlugin,
  auth,
  DeploymentsServicePlugin,
  McpAuthorizationServicePlugin,
} from '#services/plugins.ts';

function createMcpController() {
  const controller = new Elysia()
    .use(AppsServicePlugin)
    .use(DeploymentsServicePlugin)
    .use(McpAuthorizationServicePlugin);
  const { appsService, deploymentsService, mcpAuthorizationService } = controller.decorator;
  const handler = createMcpServerHandler({ appsService, deploymentsService });

  return controller.all(
    RoutePrefix.Mcp,
    async function mcpRequest({ request }) {
      const allowedHostnames = [env.BASE_URL.hostname];
      const rejected =
        hostHeaderValidationResponse(request, allowedHostnames) ??
        originValidationResponse(request, allowedHostnames);
      if (rejected) {
        return rejected;
      }
      const { internalAdapter } = await auth.$context;
      // requireMcpAuth does not expose jwtVerifyOptions for the token type and required claims.
      const protectedRequest = createMcpProtectedRequestHandler(
        {
          issuer: OAUTH_ISSUER,
          audience: MCP_RESOURCE.href,
          jwksUrl: OAUTH_JWKS_URL,
          requiredScopes: [MCP_SCOPE],
          jwtVerifyOptions: {
            typ: 'at+jwt',
            requiredClaims: McpAccessTokenClaimsSchema.required,
          },
          dpop: { replayStore: createDpopReplayStore(internalAdapter) },
        },
        function authorizedMcpRequest(...[verifiedRequest, claims]) {
          const authInfo = mcpAuthorizationService.authorize({
            request: verifiedRequest,
            claims,
          });
          return handler.fetch(verifiedRequest, { authInfo });
        },
      );
      return protectedRequest(request);
    },
    { parse: 'none', detail: { hide: true } },
  );
}

export const McpController = createMcpController();
