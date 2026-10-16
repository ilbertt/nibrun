import type { McpServer, StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { Type } from '@sinclair/typebox';
import type { OwnerId } from '#lib/api/identifiers.ts';
import { fromTypeBox } from '#lib/mcp/schema.ts';
import { handleToolResult } from '#lib/mcp/tools/shared/handle-tool-result.ts';
import { registerTool } from '#lib/mcp/tools/shared/register-tool.ts';
import { MCP_TOOL_NAMES } from '#lib/mcp/tools/shared/tool-names.ts';
import { ListAppsResponseSchema } from '#routes/api/apps/model.ts';
import type { AppsService } from '#services/apps.service.ts';

const inputSchema = fromTypeBox(Type.Object({}, { additionalProperties: false }));
const outputSchema = fromTypeBox(ListAppsResponseSchema);

type ListAppsOutput = StandardSchemaWithJSON.InferOutput<typeof outputSchema>;

export function registerListAppsTool({
  server,
  appsService,
  ownerId,
}: {
  server: McpServer;
  appsService: AppsService;
  ownerId: OwnerId;
}) {
  registerTool({
    server,
    name: MCP_TOOL_NAMES.listApps,
    config: {
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
    },
    callback: handleToolResult(async function listApps(): Promise<ListAppsOutput> {
      return { apps: await appsService.list({ ownerId }) };
    }),
  });
}
