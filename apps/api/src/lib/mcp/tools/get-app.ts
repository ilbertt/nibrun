import type { McpServer } from '@modelcontextprotocol/server';
import { appUrl } from '@repo/app-ui';
import { type AppId, AppIdSchema } from '@repo/protocol';
import { Type } from '@sinclair/typebox';
import type { OwnerId } from '#lib/api/identifiers.ts';
import { fromTypeBox } from '#lib/mcp/schema.ts';
import { handleToolResult } from '#lib/mcp/tools/shared/handle-tool-result.ts';
import { MCP_TOOL_META } from '#lib/mcp/tools/shared/tool-meta.ts';
import { DeploymentResponseSchema } from '#routes/api/apps/[appId]/deployments/model.ts';
import { AppResponseSchema } from '#routes/api/apps/model.ts';
import type { AppsService } from '#services/apps.service.ts';
import type { DeploymentsService } from '#services/deployments.service.ts';

const inputSchema = fromTypeBox(
  Type.Object({ appId: AppIdSchema }, { additionalProperties: false }),
);
const outputSchema = fromTypeBox(
  Type.Object({
    app: AppResponseSchema,
    currentDeployment: Type.Union([DeploymentResponseSchema, Type.Null()], {
      description:
        'The newest deployment, including pending, stopped or failed releases; null before the first deployment.',
    }),
    url: Type.String({
      format: 'uri',
      description:
        'The app’s public HTTPS URL, preferring an active custom domain. Availability depends on the app and deployment state.',
    }),
  }),
);

export function registerGetAppTool({
  server,
  appsService,
  deploymentsService,
  ownerId,
}: {
  server: McpServer;
  appsService: AppsService;
  deploymentsService: DeploymentsService;
  ownerId: OwnerId;
}) {
  server.registerTool(
    'get_app',
    {
      title: 'Get nibrun app',
      description:
        'Get an app owned by your connected nibrun account, its configuration, newest deployment and public URL. Environment values are redacted.',
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
    handleToolResult(async function getApp({ appId }: { appId: AppId }) {
      const app = await appsService.get({ appId, ownerId });
      const deployments = await deploymentsService.list({ appId, ownerId });
      return {
        app,
        currentDeployment: deployments[0] ?? null,
        url: appUrl(app.hostnames),
      };
    }),
  );
}
