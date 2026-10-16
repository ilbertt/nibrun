import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { Value } from '@sinclair/typebox/value';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { createLogger } from '#lib/logger.ts';
import { registerSkills } from '#lib/mcp/skills.ts';
import { registerDeployAppTool } from '#lib/mcp/tools/deploy-app.ts';
import { registerGetAppTool } from '#lib/mcp/tools/get-app.ts';
import { registerListAppsTool } from '#lib/mcp/tools/list-apps.ts';
import type { AppsService } from '#services/apps.service.ts';
import type { ArtifactsService } from '#services/artifacts.service.ts';
import type { DeploymentsService } from '#services/deployments.service.ts';

const logger = createLogger('mcp');

export function createMcpServerHandler({
  appsService,
  artifactsService,
  deploymentsService,
}: {
  appsService: AppsService;
  artifactsService: ArtifactsService;
  deploymentsService: DeploymentsService;
}) {
  return createMcpHandler(
    function createServer(context) {
      const server = new McpServer({ name: 'nibrun', version: '0.1.0' });
      const ownerId = Value.Parse(OwnerIdSchema, context.authInfo?.extra?.ownerId);
      registerSkills({ server });
      registerListAppsTool({ server, appsService, ownerId });
      registerGetAppTool({ server, appsService, deploymentsService, ownerId });
      registerDeployAppTool({ server, appsService, artifactsService, deploymentsService, ownerId });
      return server;
    },
    {
      legacy: 'stateless',
      onerror(error) {
        logger.error('MCP request failed', error);
      },
    },
  );
}
