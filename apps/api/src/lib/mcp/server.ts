import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { Value } from '@sinclair/typebox/value';
import { OAuthClientIdSchema, OwnerIdSchema } from '#lib/api/identifiers.ts';
import { createLogger } from '#lib/logger.ts';
import { registerSkills } from '#lib/mcp/skills.ts';
import { registerDeployAppTool } from '#lib/mcp/tools/deploy-app.ts';
import { registerGetAppTool } from '#lib/mcp/tools/get-app.ts';
import { registerListAppsTool } from '#lib/mcp/tools/list-apps.ts';
import { registerListFilesTool } from '#lib/mcp/tools/list-files.ts';
import { registerPrepareDeployTool } from '#lib/mcp/tools/prepare-deploy.ts';
import { registerQueryDatabaseTool } from '#lib/mcp/tools/query-database.ts';
import { registerReadLogsTool } from '#lib/mcp/tools/read-logs.ts';
import { registerUpdateAppTool } from '#lib/mcp/tools/update-app.ts';
import type { AppsService } from '#services/apps.service.ts';
import type { ArtifactsService } from '#services/artifacts.service.ts';
import type { DeploymentsService } from '#services/deployments.service.ts';
import type { FilesystemService } from '#services/filesystem.service.ts';
import type { ImageArtifactsService } from '#services/image-artifacts.service.ts';
import type { LogsService } from '#services/logs.service.ts';
import type { SqliteService } from '#services/sqlite.service.ts';

const logger = createLogger('mcp');

export function createMcpServerHandler({
  appsService,
  artifactsService,
  imageArtifactsService,
  deploymentsService,
  logsService,
  filesystemService,
  sqliteService,
}: {
  appsService: AppsService;
  artifactsService: ArtifactsService;
  imageArtifactsService: ImageArtifactsService;
  deploymentsService: DeploymentsService;
  logsService: LogsService;
  filesystemService: FilesystemService;
  sqliteService: SqliteService;
}) {
  return createMcpHandler(
    function createServer(context) {
      const server = new McpServer({ name: 'nibrun', version: '0.1.0' });
      const ownerId = Value.Parse(OwnerIdSchema, context.authInfo?.extra?.ownerId);
      const clientId = Value.Parse(OAuthClientIdSchema, context.authInfo?.clientId);
      registerSkills({ server });
      registerListAppsTool({ server, appsService, ownerId });
      registerGetAppTool({ server, appsService, deploymentsService, ownerId });
      registerReadLogsTool({ server, appsService, deploymentsService, logsService, ownerId });
      registerDeployAppTool({
        server,
        appsService,
        artifactsService,
        imageArtifactsService,
        deploymentsService,
        ownerId,
        clientId,
      });
      registerPrepareDeployTool({ server, appsService, artifactsService, ownerId });
      registerListFilesTool({
        server,
        appsService,
        deploymentsService,
        filesystemService,
        ownerId,
      });
      registerQueryDatabaseTool({ server, sqliteService, ownerId });
      registerUpdateAppTool({ server, deploymentsService, ownerId, clientId });
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
