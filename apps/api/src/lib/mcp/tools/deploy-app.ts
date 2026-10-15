import type { McpServer } from '@modelcontextprotocol/server';
import { AppIdSchema } from '@repo/protocol';
import { Type } from '@sinclair/typebox';
import type { OwnerId } from '#lib/api/identifiers.ts';
import { fromTypeBox } from '#lib/mcp/schema.ts';
import { handleToolResult } from '#lib/mcp/tools/shared/handle-tool-result.ts';
import { MCP_TOOL_META } from '#lib/mcp/tools/shared/tool-meta.ts';
import { CreateArtifactBodySchema } from '#routes/api/apps/[appId]/artifacts/model.ts';
import { DeploymentResponseSchema } from '#routes/api/apps/[appId]/deployments/model.ts';
import { AppResponseSchema } from '#routes/api/apps/model.ts';
import type { AppsService } from '#services/apps.service.ts';
import type { ArtifactsService } from '#services/artifacts.service.ts';
import type { DeploymentsService } from '#services/deployments.service.ts';

const DeployAppInputSchema = Type.Composite(
  [
    Type.Object({ appId: AppIdSchema }),
    Type.Extract(CreateArtifactBodySchema, Type.Object({ url: Type.String() })),
  ],
  { additionalProperties: false },
);
const inputSchema = fromTypeBox(DeployAppInputSchema);
const outputSchema = fromTypeBox(
  Type.Object({
    app: AppResponseSchema,
    deployment: DeploymentResponseSchema,
    url: Type.Union([Type.String({ format: 'uri' }), Type.Null()], {
      description:
        'The app’s platform HTTPS URL. A pending deployment has not been confirmed healthy.',
    }),
  }),
);

export function registerDeployAppTool({
  server,
  appsService,
  artifactsService,
  deploymentsService,
  ownerId,
}: {
  server: McpServer;
  appsService: AppsService;
  artifactsService: ArtifactsService;
  deploymentsService: DeploymentsService;
  ownerId: OwnerId;
}) {
  server.registerTool(
    'deploy_app',
    {
      title: 'Deploy nibrun app',
      description:
        'Fetch a Linux x86_64 executable from a public HTTPS URL, validate it and queue a deployment for an existing app owned by your connected nibrun account. An optional SHA-256 verifies the downloaded file. This replaces the app’s current release; calling again creates another deployment. A pending result does not mean the app is healthy.',
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
        idempotentHint: false,
      },
      _meta: MCP_TOOL_META,
    },
    handleToolResult(async function deployApp({
      appId,
      url,
      sha256,
    }: typeof DeployAppInputSchema.static) {
      const app = await appsService.get({ appId, ownerId });
      const artifact = await artifactsService.createFromUrl({
        appId,
        ownerId,
        deploymentGrant: null,
        isAnonymous: false,
        url,
        sha256,
      });
      const deployment = await deploymentsService.createOrRollback({
        appId,
        ownerId,
        isAnonymous: false,
        source: { artifactId: artifact.id },
      });
      const hostname = app.hostnames.find((entry) => entry.kind === 'platform')?.hostname;
      return { app, deployment, url: hostname === undefined ? null : `https://${hostname}` };
    }),
  );
}
