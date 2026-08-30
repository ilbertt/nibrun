import { McpServer } from '@modelcontextprotocol/server';
import type { OwnerId } from '@repo/protocol';
import type { McpServices } from '#lib/mcp/services.ts';
import { registerDeleteAppTool } from '#lib/mcp/tools/apps/delete.ts';
import { registerDeployAppTool } from '#lib/mcp/tools/apps/deploy.ts';
import { registerAddDomainTool } from '#lib/mcp/tools/apps/domains/add.ts';
import { registerRemoveDomainTool } from '#lib/mcp/tools/apps/domains/remove.ts';
import { registerGetExportTool } from '#lib/mcp/tools/apps/export/get.ts';
import { registerExportAppTool } from '#lib/mcp/tools/apps/export/request.ts';
import { registerListFilesTool } from '#lib/mcp/tools/apps/files.ts';
import { registerGetAppTool } from '#lib/mcp/tools/apps/get.ts';
import { registerListAppsTool } from '#lib/mcp/tools/apps/list.ts';
import { registerReadLogsTool } from '#lib/mcp/tools/apps/logs.ts';
import { registerRedeployAppTool } from '#lib/mcp/tools/apps/redeploy.ts';
import { registerResumeAppTool } from '#lib/mcp/tools/apps/resume.ts';
import { registerSuspendAppTool } from '#lib/mcp/tools/apps/suspend.ts';

const SERVER_INFO = {
  name: 'nibrun',
  title: 'nibrun',
  version: '1.0.0',
};

const INSTRUCTIONS = `nibrun hosts a compiled binary in an isolated guest with a persistent volume mounted at data/.

Apps are addressed by slug; \`list_apps\` is where a slug comes from. A binary is only ever fetched
by nibrun from an https url — there is no way to send one from this end.

An app's state decides what it will answer: a tool that refuses says why and what to do instead,
so read the refusal rather than retrying it.`;

/**
 * The tools, over one caller's view of the api.
 *
 * Built per request rather than once: every tool is bound to the owner the request authenticated
 * as, so a server held across requests would be one caller's reach handed to the next.
 *
 * Every tool is registered here by hand. A file under `tools/` that nothing calls is a tool no
 * client can reach, and nothing else in the package would notice — which is what the tool listing
 * is tested against.
 */
export function createNibrunMcpServer({
  services,
  ownerId,
}: {
  services: McpServices;
  ownerId: OwnerId;
}): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  const registration = { server, services, ownerId };

  registerListAppsTool(registration);
  registerGetAppTool(registration);
  registerDeployAppTool(registration);
  registerRedeployAppTool(registration);
  registerSuspendAppTool(registration);
  registerResumeAppTool(registration);
  registerDeleteAppTool(registration);
  registerAddDomainTool(registration);
  registerRemoveDomainTool(registration);
  registerReadLogsTool(registration);
  registerListFilesTool(registration);
  registerExportAppTool(registration);
  registerGetExportTool(registration);

  return server;
}
