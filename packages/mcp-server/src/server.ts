import { McpServer } from '@modelcontextprotocol/server';
import type { PublicApiClient } from '@repo/api-client/public';
import { registerAppTools } from '#tools/apps.ts';
import { registerDomainTools } from '#tools/domains.ts';
import { registerExportTools } from '#tools/exports.ts';
import { registerFilesystemTools } from '#tools/filesystem.ts';
import { registerLifecycleTools } from '#tools/lifecycle.ts';
import { registerLogTools } from '#tools/logs.ts';
import { registerReleaseTools } from '#tools/release.ts';

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
 * Built per request rather than once: the client it acts through carries the caller's credential,
 * so a server held across requests would be one caller's access handed to the next.
 */
export function createNibrunMcpServer({ api }: { api: PublicApiClient }): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  const registration = { server, api };

  registerAppTools(registration);
  registerReleaseTools(registration);
  registerLifecycleTools(registration);
  registerDomainTools(registration);
  registerLogTools(registration);
  registerFilesystemTools(registration);
  registerExportTools(registration);

  return server;
}
