import type { McpServer } from '@modelcontextprotocol/server';
import { Type } from '@sinclair/typebox';
import type { OwnerId } from '#lib/api/identifiers.ts';
import { fromTypeBox } from '#lib/mcp/schema.ts';
import { handleToolResult } from '#lib/mcp/tools/shared/handle-tool-result.ts';
import { MCP_TOOL_META } from '#lib/mcp/tools/shared/tool-meta.ts';
import { ListAppsResponseSchema } from '#routes/api/apps/model.ts';
import type { AnalyticsServiceContract } from '#services/analytics.service.ts';
import type { AppsService } from '#services/apps.service.ts';

const inputSchema = fromTypeBox(Type.Object({}, { additionalProperties: false }));
const outputSchema = fromTypeBox(ListAppsResponseSchema);
const TOOL_NAME = 'list_apps';

export function registerListAppsTool({
  server,
  appsService,
  ownerId,
  analyticsService,
  trackingAllowed,
}: {
  server: McpServer;
  appsService: AppsService;
  ownerId: OwnerId;
  analyticsService: AnalyticsServiceContract;
  trackingAllowed: boolean;
}) {
  server.registerTool(
    TOOL_NAME,
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
    handleToolResult({
      analyticsService,
      ownerId,
      toolName: TOOL_NAME,
      trackingAllowed,
      async callback() {
        return { apps: await appsService.list({ ownerId }) };
      },
    }),
  );
}
