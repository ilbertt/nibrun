import {
  createMcpHandler,
  McpServer,
  originValidationResponse,
  requireBearerAuth,
} from '@modelcontextprotocol/server';
import { Value } from '@sinclair/typebox/value';
import { Elysia } from 'elysia';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { env } from '#lib/env.ts';
import { createLogger } from '#lib/logger.ts';
import { MCP_RESOURCE, MCP_RESOURCE_METADATA_URL, MCP_SCOPES } from '#lib/mcp.ts';
import { mcpSchema } from '#lib/mcp-schema.ts';
import { RoutePrefix } from '#lib/routes/prefixes.ts';
import { ListAppsResponseSchema } from '#routes/api/apps/model.ts';
import { ListAppsInputSchema } from '#routes/mcp/model.ts';
import { AppsServicePlugin, McpAuthorizationServicePlugin } from '#services/plugins.ts';

const listAppsInputSchema = mcpSchema(ListAppsInputSchema);
const listAppsOutputSchema = mcpSchema(ListAppsResponseSchema);

function createMcpController() {
  const controller = new Elysia().use(AppsServicePlugin).use(McpAuthorizationServicePlugin);
  const { appsService, mcpAuthorizationService } = controller.decorator;
  const logger = createLogger('mcp');
  const authenticate = requireBearerAuth({
    verifier: mcpAuthorizationService,
    expectedResource: MCP_RESOURCE,
    requiredScopes: MCP_SCOPES,
    resourceMetadataUrl: MCP_RESOURCE_METADATA_URL,
  });

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
      const authInfo = await authenticate(request);
      if (authInfo instanceof Response) {
        return authInfo;
      }
      return handler.fetch(request, { authInfo });
    },
    { parse: 'none' },
  );
}

export const McpController = createMcpController();
