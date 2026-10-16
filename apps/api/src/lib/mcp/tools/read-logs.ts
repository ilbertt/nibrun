import type { McpServer, StandardSchemaWithJSON, ToolCallback } from '@modelcontextprotocol/server';
import { DEFAULT_LOG_TIMERANGE } from '@repo/api-constants';
import { AppIdSchema, TenantLogRecordSchema } from '@repo/protocol';
import { Type } from '@sinclair/typebox';
import type { OwnerId } from '#lib/api/identifiers.ts';
import { fromTypeBox } from '#lib/mcp/schema.ts';
import { handleToolResult } from '#lib/mcp/tools/shared/handle-tool-result.ts';
import { registerTool } from '#lib/mcp/tools/shared/register-tool.ts';
import { MCP_TOOL_NAMES } from '#lib/mcp/tools/shared/tool-names.ts';
import { StreamLogsQuerySchema } from '#routes/api/apps/[appId]/deployments/[deploymentId]/logs/model.ts';
import type { AppsService } from '#services/apps.service.ts';
import type { DeploymentsService } from '#services/deployments.service.ts';
import type { LogsService } from '#services/logs.service.ts';

const inputSchema = fromTypeBox(
  Type.Object(
    {
      appId: AppIdSchema,
      timerange: StreamLogsQuerySchema.properties.timerange,
    },
    { additionalProperties: false },
  ),
);
const outputSchema = fromTypeBox(Type.Object({ logs: Type.Array(TenantLogRecordSchema) }));

type ReadLogsOutput = StandardSchemaWithJSON.InferOutput<typeof outputSchema>;

export function registerReadLogsTool({
  server,
  appsService,
  deploymentsService,
  logsService,
  ownerId,
}: {
  server: McpServer;
  appsService: AppsService;
  deploymentsService: DeploymentsService;
  logsService: LogsService;
  ownerId: OwnerId;
}) {
  registerTool({
    server,
    name: MCP_TOOL_NAMES.readLogs,
    config: {
      title: 'Read nibrun logs',
      description: `Read stored stdout and stderr logs for an app's newest deployment, including pending, stopped or failed releases. Supply appId for an app owned by your connected nibrun account. Optionally set timerange to a duration such as 30s, 5m or 2h; defaults to ${DEFAULT_LOG_TIMERANGE}. Returns available records in chronological order and finishes without subscribing to new logs. Returns empty logs before the first deployment.`,
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
    },
    callback: handleToolResult(async function readLogs(
      ...[
        { appId, timerange },
        {
          mcpReq: { signal },
        },
      ]: Parameters<ToolCallback<typeof inputSchema>>
    ): Promise<ReadLogsOutput> {
      await appsService.get({ appId, ownerId });
      const deployments = await deploymentsService.list({ appId, ownerId });
      const deployment = deployments[0];
      if (!deployment) {
        return { logs: [] };
      }
      const records = await logsService.openStream({
        appId,
        deploymentId: deployment.id,
        ownerId,
        timerange: timerange ?? DEFAULT_LOG_TIMERANGE,
        follow: false,
        signal,
      });
      const logs: ReadLogsOutput['logs'] = [];
      for await (const record of records) {
        logs.push(record);
      }
      return { logs };
    }),
  });
}
