import type { McpServer, ToolCallback } from '@modelcontextprotocol/server';
import { MCP_TOOL_NAMES } from '@repo/api-constants';
import { AppIdSchema } from '@repo/protocol';
import { Type } from '@sinclair/typebox';
import { RuntimeSettingsPatchSchema } from '#lib/api/app.ts';
import { McpDeploymentSchema } from '#lib/api/deployment.ts';
import type { OAuthClientId, OwnerId } from '#lib/api/identifiers.ts';
import { fromTypeBox } from '#lib/mcp/schema.ts';
import { deploymentChatId } from '#lib/mcp/tools/shared/chat-id.ts';
import { handleToolResult } from '#lib/mcp/tools/shared/handle-tool-result.ts';
import { registerTool } from '#lib/mcp/tools/shared/register-tool.ts';
import { DeploymentResponseSchema } from '#routes/api/apps/[appId]/deployments/model.ts';
import type { DeploymentsService } from '#services/deployments.service.ts';

const inputSchema = fromTypeBox(
  Type.Object(
    {
      appId: AppIdSchema,
      config: RuntimeSettingsPatchSchema,
      chatId: McpDeploymentSchema.properties.chatId,
    },
    { additionalProperties: false },
  ),
);
const outputSchema = fromTypeBox(Type.Object({ deployment: DeploymentResponseSchema }));

export function registerUpdateAppTool({
  server,
  deploymentsService,
  ownerId,
  clientId,
}: {
  server: McpServer;
  deploymentsService: DeploymentsService;
  ownerId: OwnerId;
  clientId: OAuthClientId;
}) {
  registerTool({
    server,
    name: MCP_TOOL_NAMES.updateApp,
    config: {
      title: 'Update nibrun app settings',
      description:
        'Update startup arguments, HTTP port or HTTP access for an existing app and redeploy its latest binary. Supply only the settings to change. An empty args array clears startup arguments. Public access allows unauthenticated requests. Returns the new deployment, which may still be pending.',
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
        idempotentHint: false,
      },
    },
    callback: handleToolResult(async function updateApp(
      ...[{ appId, config, chatId }, { mcpReq }]: Parameters<ToolCallback<typeof inputSchema>>
    ) {
      const deployment = await deploymentsService.createWithMcpClient({
        appId,
        config,
        ownerId,
        clientId,
        chatId: deploymentChatId({ chatId, sessionId: mcpReq._meta?.['openai/session'] }),
      });
      return { deployment };
    }),
  });
}
