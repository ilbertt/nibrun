import type { McpServer, StandardSchemaWithJSON, ToolCallback } from '@modelcontextprotocol/server';
import { AppIdSchema, DirectoryListingSchema, GUEST_PATH_ROOT } from '@repo/protocol';
import { Type } from '@sinclair/typebox';
import type { OwnerId } from '#lib/api/identifiers.ts';
import { NotFoundError } from '#lib/errors.ts';
import { DIRECTORY_READ_TIMEOUT_MS } from '#lib/filesystem/timeouts.ts';
import { fromTypeBox } from '#lib/mcp/schema.ts';
import { handleToolResult } from '#lib/mcp/tools/shared/handle-tool-result.ts';
import { registerTool } from '#lib/mcp/tools/shared/register-tool.ts';
import { MCP_TOOL_NAMES } from '#lib/mcp/tools/shared/tool-names.ts';
import { ReadDirectoryQuerySchema } from '#routes/api/apps/[appId]/deployments/[deploymentId]/filesystem/model.ts';
import type { AppsService } from '#services/apps.service.ts';
import type { DeploymentsService } from '#services/deployments.service.ts';
import type { FilesystemService } from '#services/filesystem.service.ts';

const inputSchema = fromTypeBox(
  Type.Object(
    {
      appId: AppIdSchema,
      ...ReadDirectoryQuerySchema.properties,
    },
    { additionalProperties: false },
  ),
);
const outputSchema = fromTypeBox(DirectoryListingSchema);

type ListFilesOutput = StandardSchemaWithJSON.InferOutput<typeof outputSchema>;

export function registerListFilesTool({
  server,
  appsService,
  deploymentsService,
  filesystemService,
  ownerId,
}: {
  server: McpServer;
  appsService: AppsService;
  deploymentsService: DeploymentsService;
  filesystemService: FilesystemService;
  ownerId: OwnerId;
}) {
  registerTool({
    server,
    name: MCP_TOOL_NAMES.listFiles,
    config: {
      title: 'List nibrun files',
      description:
        'List one directory on an app’s persistent data volume using its newest deployment, including pending, stopped or failed releases. Supply appId for an app owned by your connected nibrun account. The optional path is absolute within the volume and defaults to /, the data/ directory seen by your app. Returns entry names, kinds, sizes and modification times; truncated indicates more entries exist. Does not read file contents or recurse. Requires a deployment and a host holding the volume to answer.',
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
    },
    callback: handleToolResult(async function listFiles(
      ...[
        { appId, path },
        {
          mcpReq: { signal },
        },
      ]: Parameters<ToolCallback<typeof inputSchema>>
    ): Promise<ListFilesOutput> {
      await appsService.get({ appId, ownerId });
      const deployment = await deploymentsService.getLatestDeployment({ appId, ownerId });
      if (!deployment) {
        throw new NotFoundError('Deployment not found.');
      }
      return filesystemService.readDirectory({
        appId,
        deploymentId: deployment.id,
        ownerId,
        path: path ?? GUEST_PATH_ROOT,
        signal: AbortSignal.any([signal, AbortSignal.timeout(DIRECTORY_READ_TIMEOUT_MS)]),
      });
    }),
  });
}
