import type { McpServer, StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { appUrl } from '@repo/app-ui';
import { FilenameSchema } from '@repo/protocol';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { ArtifactIdSchema, type OAuthClientId, type OwnerId } from '#lib/api/identifiers.ts';
import { fromTypeBox } from '#lib/mcp/schema.ts';
import {
  appForDeployment,
  DeploymentTargetSchema,
} from '#lib/mcp/tools/shared/deployment-target.ts';
import { handleToolResult } from '#lib/mcp/tools/shared/handle-tool-result.ts';
import { registerTool } from '#lib/mcp/tools/shared/register-tool.ts';
import { MCP_TOOL_NAMES } from '#lib/mcp/tools/shared/tool-names.ts';
import { CreateArtifactBodySchema } from '#routes/api/apps/[appId]/artifacts/model.ts';
import { DeploymentResponseSchema } from '#routes/api/apps/[appId]/deployments/model.ts';
import { AppResponseSchema } from '#routes/api/apps/model.ts';
import type { AppsService } from '#services/apps.service.ts';
import type { ArtifactsService } from '#services/artifacts.service.ts';
import type { DeploymentsService } from '#services/deployments.service.ts';

const FetchedBinarySchema = Type.Extract(
  CreateArtifactBodySchema,
  Type.Object({ url: Type.String() }),
);
const ChatGptFileInputSchema = Type.Object(
  {
    download_url: FetchedBinarySchema.properties.url,
    file_id: Type.String({ minLength: 1 }),
    mime_type: Type.Optional(Type.String()),
    file_name: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
const DEFAULT_BINARY_FILENAME = Value.Parse(FilenameSchema, 'app');
const DeployAppInputSchema = Type.Object(
  {
    ...DeploymentTargetSchema.properties,
    artifactId: Type.Optional(ArtifactIdSchema),
    url: Type.Optional(FetchedBinarySchema.properties.url),
    binary: Type.Optional(ChatGptFileInputSchema),
    sha256: FetchedBinarySchema.properties.sha256,
  },
  {
    additionalProperties: false,
    oneOf: [{ required: ['url'] }, { required: ['binary'] }, { required: ['artifactId'] }],
    allOf: [
      ...DeploymentTargetSchema.allOf,
      { not: { required: ['name', 'artifactId'] } },
      { not: { required: ['sha256', 'artifactId'] } },
    ],
  },
);
const inputSchema = fromTypeBox(DeployAppInputSchema);
const outputSchema = fromTypeBox(
  Type.Object({
    app: AppResponseSchema,
    deployment: DeploymentResponseSchema,
    url: Type.String({
      format: 'uri',
      description:
        'The app’s public HTTPS URL, preferring an active custom domain. A pending deployment has not been confirmed healthy.',
    }),
  }),
);

type DeployAppInput = StandardSchemaWithJSON.InferOutput<typeof inputSchema>;
type DeployAppOutput = StandardSchemaWithJSON.InferOutput<typeof outputSchema>;

export function registerDeployAppTool({
  server,
  appsService,
  artifactsService,
  deploymentsService,
  ownerId,
  clientId,
}: {
  server: McpServer;
  appsService: AppsService;
  artifactsService: ArtifactsService;
  deploymentsService: DeploymentsService;
  ownerId: OwnerId;
  clientId: OAuthClientId;
}) {
  registerTool({
    server,
    name: MCP_TOOL_NAMES.deployApp,
    config: {
      title: 'Deploy nibrun app',
      description: `Deploy a Linux x86_64 executable to your connected nibrun account. Supply a name and optional initial config to create an app, or appId to redeploy. Supply exactly one source: a binary file through native client file binding, a public HTTPS url, or an uploaded artifactId with appId. If native file binding is unavailable and the binary has no HTTPS download URL, first call ${MCP_TOOL_NAMES.prepareDeploy}, upload the bytes as it describes, then call this tool with its app.id and upload.artifactId. An optional sha256 verifies downloaded binaries. Reuse app.id for subsequent deployments. Each call creates a deployment and replaces the current release. A pending result is not confirmed healthy.`,
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
        idempotentHint: false,
      },
      _meta: { 'openai/fileParams': ['binary'] },
    },
    callback: handleToolResult(async function deployApp(
      input: DeployAppInput,
    ): Promise<DeployAppOutput> {
      const { artifactId, url, binary, sha256 } = input;
      const app = await appForDeployment({ appsService, ownerId, target: input });
      const artifact =
        artifactId === undefined
          ? await artifactsService.createFromUrl({
              appId: app.id,
              ownerId,
              deploymentGrant: null,
              isAnonymous: false,
              url: Value.Parse(FetchedBinarySchema.properties.url, binary?.download_url ?? url),
              filename:
                binary === undefined
                  ? undefined
                  : Value.Check(FilenameSchema, binary.file_name)
                    ? binary.file_name
                    : DEFAULT_BINARY_FILENAME,
              sha256,
            })
          : await artifactsService.completeUpload({ appId: app.id, ownerId, artifactId });
      const deployment = await deploymentsService.createWithMcpClient({
        appId: app.id,
        ownerId,
        clientId,
        artifactId: artifact.id,
      });
      return { app, deployment, url: appUrl(app.hostnames) };
    }),
  });
}
