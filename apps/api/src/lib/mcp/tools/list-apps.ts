import type { McpServer } from '@modelcontextprotocol/server';
import { Type } from '@sinclair/typebox';
import type { OwnerId } from '#lib/api/identifiers.ts';
import { MCP_SCOPE } from '#lib/mcp/auth.ts';
import { handleResult } from '#lib/mcp/handle-result.ts';
import { fromTypeBox } from '#lib/mcp/schema.ts';
import { ListAppsResponseSchema } from '#routes/api/apps/model.ts';
import type { AppsService } from '#services/apps.service.ts';

const inputSchema = fromTypeBox(Type.Object({}, { additionalProperties: false }));
const outputSchema = fromTypeBox(ListAppsResponseSchema);

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
    handleResult(async function listApps() {
      return { apps: await appsService.list({ ownerId }) };
    }),
  );
}
