import type { McpServer } from '@modelcontextprotocol/server';
import { Type } from '@sinclair/typebox';
import type { OwnerId } from '#lib/api/identifiers.ts';
import { createLogger } from '#lib/logger.ts';
import { MCP_SCOPE } from '#lib/mcp/auth.ts';
import { fromTypeBox } from '#lib/mcp/schema.ts';
import { ListAppsResponseSchema } from '#routes/api/apps/model.ts';
import type { AppsService } from '#services/apps.service.ts';

const inputSchema = fromTypeBox(Type.Object({}, { additionalProperties: false }));
const outputSchema = fromTypeBox(ListAppsResponseSchema);
const logger = createLogger('mcp:list_apps');

export function registerListAppsTool({
  server,
  appsService,
  ownerId,
}: {
  server: McpServer;
  appsService: AppsService;
  ownerId: OwnerId;
}) {
  server.registerTool(
    'list_apps',
    {
      title: 'List nibrun apps',
      description: 'List the apps owned by your connected nibrun account.',
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: [MCP_SCOPE] }] },
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
}
