import type { McpServer, StandardSchemaWithJSON, ToolCallback } from '@modelcontextprotocol/server';
import {
  AppIdSchema,
  DeploymentIdSchema,
  DirectoryListingSchema,
  GUEST_PATH_ROOT,
} from '@repo/protocol';
import { Type } from '@sinclair/typebox';
import type { OwnerId } from '#lib/api/identifiers.ts';
import { DIRECTORY_READ_TIMEOUT_MS } from '#lib/filesystem/timeouts.ts';
import { fromTypeBox } from '#lib/mcp/schema.ts';
import { handleToolResult } from '#lib/mcp/tools/shared/handle-tool-result.ts';
import { registerTool } from '#lib/mcp/tools/shared/register-tool.ts';
import { MCP_TOOL_NAMES } from '#lib/mcp/tools/shared/tool-names.ts';
import { ReadDirectoryQuerySchema } from '#routes/api/apps/[appId]/deployments/[deploymentId]/filesystem/model.ts';
import type { FilesystemService } from '#services/filesystem.service.ts';

const inputSchema = fromTypeBox(
  Type.Object(
    {
      appId: AppIdSchema,
      deploymentId: DeploymentIdSchema,
      ...ReadDirectoryQuerySchema.properties,
    },
    { additionalProperties: false },
  ),
);
const outputSchema = fromTypeBox(DirectoryListingSchema);

type ListFilesOutput = StandardSchemaWithJSON.InferOutput<typeof outputSchema>;

export function registerListFilesTool({
  server,
  filesystemService,
  ownerId,
}: {
  server: McpServer;
  filesystemService: FilesystemService;
  ownerId: OwnerId;
}) {
  registerTool({
    server,
    name: MCP_TOOL_NAMES.listFiles,
    config: {
      title: 'List nibrun files',
      description: `List one directory on an app’s persistent data volume, using a deployment owned by your connected nibrun account. Supply appId and deploymentId from ${MCP_TOOL_NAMES.getApp}. The optional path is absolute within the volume and defaults to /, the data/ directory seen by your app. Returns entry names, kinds, sizes and modification times; truncated indicates more entries exist. Does not read file contents or recurse. Requires a host holding the volume to answer.`,
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
    },
    callback: handleToolResult(function listFiles(
      ...[
        { appId, deploymentId, path },
        {
          mcpReq: { signal },
        },
      ]: Parameters<ToolCallback<typeof inputSchema>>
    ): Promise<ListFilesOutput> {
      return filesystemService.readDirectory({
        appId,
        deploymentId,
        ownerId,
        path: path ?? GUEST_PATH_ROOT,
        signal: AbortSignal.any([signal, AbortSignal.timeout(DIRECTORY_READ_TIMEOUT_MS)]),
      });
    }),
  });
}
