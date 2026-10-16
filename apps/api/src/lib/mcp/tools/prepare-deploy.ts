import type { McpServer, StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { Type } from '@sinclair/typebox';
import type { OwnerId } from '#lib/api/identifiers.ts';
import { fromTypeBox } from '#lib/mcp/schema.ts';
import { DEPLOY_TO_NIBRUN_SKILL_URI } from '#lib/mcp/skills.ts';
import {
  appForDeployment,
  DeploymentTargetSchema,
} from '#lib/mcp/tools/shared/deployment-target.ts';
import { handleToolResult } from '#lib/mcp/tools/shared/handle-tool-result.ts';
import { registerTool } from '#lib/mcp/tools/shared/register-tool.ts';
import { MCP_TOOL_NAMES } from '#lib/mcp/tools/shared/tool-names.ts';
import {
  CreateArtifactBodySchema,
  CreateArtifactResponseSchema,
} from '#routes/api/apps/[appId]/artifacts/model.ts';
import { AppResponseSchema } from '#routes/api/apps/model.ts';
import type { AppsService } from '#services/apps.service.ts';
import type { ArtifactsService } from '#services/artifacts.service.ts';

const UploadedBinarySchema = Type.Extract(
  CreateArtifactBodySchema,
  Type.Object({ filename: Type.String() }),
);
const StagedUploadSchema = Type.Extract(
  CreateArtifactResponseSchema,
  Type.Object({ artifactId: Type.String() }),
);
const inputSchema = fromTypeBox(
  Type.Object(
    { ...DeploymentTargetSchema.properties, ...UploadedBinarySchema.properties },
    { additionalProperties: false, allOf: DeploymentTargetSchema.allOf },
  ),
);
const outputSchema = fromTypeBox(
  Type.Object({ app: AppResponseSchema, upload: StagedUploadSchema }),
);

type PrepareDeployInput = StandardSchemaWithJSON.InferOutput<typeof inputSchema>;
type PrepareDeployOutput = StandardSchemaWithJSON.InferOutput<typeof outputSchema>;

export function registerPrepareDeployTool({
  server,
  appsService,
  artifactsService,
  ownerId,
}: {
  server: McpServer;
  appsService: AppsService;
  artifactsService: ArtifactsService;
  ownerId: OwnerId;
}) {
  registerTool({
    server,
    name: MCP_TOOL_NAMES.prepareDeploy,
    config: {
      title: 'Prepare nibrun deployment',
      description: `Prepare a direct HTTP binary upload for a new or existing app. Requires file access and HTTP upload capability; does not deploy. Read ${DEPLOY_TO_NIBRUN_SKILL_URI} via resources/read for upload steps, then call ${MCP_TOOL_NAMES.deployApp}.`,
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: false,
      },
    },
    callback: handleToolResult(async function prepareDeploy(
      input: PrepareDeployInput,
    ): Promise<PrepareDeployOutput> {
      const app = await appForDeployment({ appsService, ownerId, target: input });
      const upload = await artifactsService.create({
        appId: app.id,
        ownerId,
        deploymentGrant: null,
        isAnonymous: false,
        filename: input.filename,
        sizeBytes: input.sizeBytes,
      });
      return { app, upload };
    }),
  });
}
