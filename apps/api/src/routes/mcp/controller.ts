import { createMcpProtectedRequestHandler } from '@better-auth/mcp';
import {
  createMcpHandler,
  McpServer,
  originValidationResponse,
} from '@modelcontextprotocol/server';
import { Value } from '@sinclair/typebox/value';
import { createDpopReplayStore } from 'better-auth/oauth2';
import { Elysia } from 'elysia';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { OAUTH_ISSUER, OAUTH_JWKS_URL } from '#lib/auth/oauth-issuer.ts';
import { env } from '#lib/env.ts';
import { createLogger } from '#lib/logger.ts';
import { MCP_RESOURCE, MCP_SCOPES, McpAccessTokenClaimsSchema } from '#lib/mcp.ts';
import { mcpSchema } from '#lib/mcp-schema.ts';
import { RoutePrefix } from '#lib/routes/prefixes.ts';
import { ListAppsResponseSchema } from '#routes/api/apps/model.ts';
import { ListAppsInputSchema } from '#routes/mcp/model.ts';
import { AppsServicePlugin, auth, McpAuthorizationServicePlugin } from '#services/plugins.ts';

const listAppsInputSchema = mcpSchema(ListAppsInputSchema);
const listAppsOutputSchema = mcpSchema(ListAppsResponseSchema);

function createMcpController() {
  const controller = new Elysia().use(AppsServicePlugin).use(McpAuthorizationServicePlugin);
  const { appsService, mcpAuthorizationService } = controller.decorator;
  const logger = createLogger('mcp');
  const handler = createMcpHandler(
    function createServer(context) {
      const server = new McpServer({ name: 'nibrun', version: '0.1.0' });
      const ownerId = Value.Parse(OwnerIdSchema, context.authInfo?.extra?.ownerId);
      server.registerTool(
        'list_apps',
        {
          title: 'List nibrun apps',
          description: 'List the apps owned by your connected nibrun account.',
          inputSchema: listAppsInputSchema,
          outputSchema: listAppsOutputSchema,
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            openWorldHint: false,
            idempotentHint: true,
          },
          _meta: { securitySchemes: [{ type: 'oauth2', scopes: MCP_SCOPES }] },
        },
        async function listApps() {
          try {
            const result = { apps: await appsService.list({ ownerId }) };
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
              structuredContent: result,
            };
          } catch (error) {
            logger.error('list_apps failed', error);
            return {
              isError: true,
              content: [{ type: 'text', text: 'Unable to list apps. Try again later.' }],
            };
          }
        },
      );
      return server;
    },
    {
      onerror(error) {
        logger.error('MCP request failed', error);
      },
    },
  );

  return controller.all(
    RoutePrefix.Mcp,
    async function mcpRequest({ request }) {
      const originError = originValidationResponse(request, [env.BASE_URL.origin]);
      if (originError) {
        return originError;
      }
      const { internalAdapter } = await auth.$context;
      const protectedRequest = createMcpProtectedRequestHandler(
        {
          issuer: OAUTH_ISSUER,
          audience: MCP_RESOURCE.href,
          jwksUrl: OAUTH_JWKS_URL,
          requiredScopes: MCP_SCOPES,
          jwtVerifyOptions: {
            typ: 'at+jwt',
            requiredClaims: McpAccessTokenClaimsSchema.required,
          },
          dpop: { replayStore: createDpopReplayStore(internalAdapter) },
        },
        async function authorizedMcpRequest(...[verifiedRequest, claims]) {
          const authInfo = await mcpAuthorizationService.authorize({
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
