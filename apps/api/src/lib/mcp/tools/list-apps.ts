import type { McpServer } from '@modelcontextprotocol/server';
import { Type } from '@sinclair/typebox';
import type { OwnerId } from '#lib/api/identifiers.ts';
import { fromTypeBox } from '#lib/mcp/schema.ts';
import { handleToolResult } from '#lib/mcp/tools/shared/handle-tool-result.ts';
import { MCP_TOOL_META } from '#lib/mcp/tools/shared/tool-meta.ts';
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
      _meta: MCP_TOOL_META,
    },
    handleToolResult(async function listApps() {
      return { apps: await appsService.list({ ownerId }) };
    }),
  );
}
