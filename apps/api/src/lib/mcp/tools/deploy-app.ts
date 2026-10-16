import type { McpServer, StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { appUrl } from '@repo/app-ui';
import { AppIdSchema, FilenameSchema } from '@repo/protocol';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { OwnerId } from '#lib/api/identifiers.ts';
import { fromTypeBox } from '#lib/mcp/schema.ts';
import { handleToolResult } from '#lib/mcp/tools/shared/handle-tool-result.ts';
import { registerTool } from '#lib/mcp/tools/shared/register-tool.ts';
import { CreateArtifactBodySchema } from '#routes/api/apps/[appId]/artifacts/model.ts';
import { DeploymentResponseSchema } from '#routes/api/apps/[appId]/deployments/model.ts';
import { AppResponseSchema, CreateAppRequestSchema } from '#routes/api/apps/model.ts';
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
    appId: Type.Optional(AppIdSchema),
    name: Type.Optional(CreateAppRequestSchema.properties.name),
    config: CreateAppRequestSchema.properties.config,
    url: Type.Optional(FetchedBinarySchema.properties.url),
    binary: Type.Optional(ChatGptFileInputSchema),
    sha256: FetchedBinarySchema.properties.sha256,
  },
  {
    additionalProperties: false,
    oneOf: [{ required: ['url'] }, { required: ['binary'] }],
    allOf: [
      { oneOf: [{ required: ['appId'] }, { required: ['name'] }] },
      { not: { required: ['appId', 'config'] } },
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
}: {
  server: McpServer;
  appsService: AppsService;
  artifactsService: ArtifactsService;
  deploymentsService: DeploymentsService;
  ownerId: OwnerId;
}) {
  registerTool({
    server,
    name: 'deploy_app',
    config: {
      title: 'Deploy nibrun app',
      description:
        'Deploy a Linux x86_64 executable to your connected nibrun account. Supply a name and optional initial config to create an app, or appId to redeploy an existing app. Reuse the returned app.id for subsequent deployments. Supply exactly one source: a binary file when supported by the client, or a public HTTPS url. An optional SHA-256 verifies the downloaded file. This replaces the current release; calling again creates another deployment. A pending result does not mean the app is healthy.',
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
    callback: handleToolResult(async function deployApp({
      appId,
      name,
      config,
      url,
      binary,
      sha256,
    }: DeployAppInput): Promise<DeployAppOutput> {
      const app =
        appId === undefined
          ? await appsService.create({
              ownerId,
              isAnonymous: false,
              name: Value.Parse(CreateAppRequestSchema.properties.name, name),
              config,
            })
          : await appsService.get({ appId, ownerId });
      const sourceUrl = Value.Parse(
        FetchedBinarySchema.properties.url,
        binary?.download_url ?? url,
      );
      const filename =
        binary === undefined
          ? undefined
          : Value.Check(FilenameSchema, binary.file_name)
            ? binary.file_name
            : DEFAULT_BINARY_FILENAME;
      const artifact = await artifactsService.createFromUrl({
        appId: app.id,
        ownerId,
        deploymentGrant: null,
        isAnonymous: false,
        url: sourceUrl,
        filename,
        sha256,
      });
      const deployment = await deploymentsService.createOrRollback({
        appId: app.id,
        ownerId,
        isAnonymous: false,
        source: { artifactId: artifact.id },
      });
      return { app, deployment, url: appUrl(app.hostnames) };
    }),
  });
}
