import type { McpServer, StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { MCP_TOOL_NAMES } from '@repo/api-constants';
import { AppIdSchema } from '@repo/protocol';
import { Type } from '@sinclair/typebox';
import { VolumeStorageLocationSchema } from '#lib/api/customer-volume.ts';
import type { OwnerId } from '#lib/api/identifiers.ts';
import { MCP_RESOURCE } from '#lib/mcp/auth.ts';
import { fromTypeBox } from '#lib/mcp/schema.ts';
import { handleToolResult } from '#lib/mcp/tools/shared/handle-tool-result.ts';
import { registerTool } from '#lib/mcp/tools/shared/register-tool.ts';
import type { AppsService } from '#services/apps.service.ts';

const inputSchema = fromTypeBox(
  Type.Object(
    { appId: AppIdSchema, setupCode: Type.Optional(Type.String({ minLength: 1 })) },
    { additionalProperties: false },
  ),
);
const outputSchema = fromTypeBox(
  Type.Object({
    state: Type.Union([Type.Literal('awaiting_setup'), Type.Literal('configured')]),
    setupUrl: Type.Optional(Type.String({ format: 'uri' })),
    volumeStorage: Type.Optional(VolumeStorageLocationSchema),
  }),
);

export function registerSetAppBucketTool({
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
    name: MCP_TOOL_NAMES.setAppBucket,
    config: {
      title: 'Configure an app’s custom bucket',
      description:
        'Call with appId to get the private dashboard form. Ask the owner to enter their bucket credentials there and return its short-lived setup code. Call again with appId and setupCode to apply the configuration. The next deployment uses the bucket and pauses the app while copying existing managed data.',
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
        idempotentHint: false,
      },
    },
    callback: handleToolResult(async function setAppBucket({
      appId,
      setupCode,
    }: StandardSchemaWithJSON.InferOutput<typeof inputSchema>): Promise<
      StandardSchemaWithJSON.InferOutput<typeof outputSchema>
    > {
      if (setupCode === undefined) {
        await appsService.requireBucketSetup({ appId, ownerId });
        return {
          state: 'awaiting_setup',
          setupUrl: new URL(`/apps/${encodeURIComponent(appId)}/bucket-setup`, MCP_RESOURCE).href,
        };
      }
      const volumeStorage = await appsService.applyBucketSetup({ appId, ownerId, setupCode });
      return { state: 'configured', volumeStorage };
    }),
  });
}
