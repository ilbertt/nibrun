import {
  AGENT_ROUTES,
  FilesystemQueryRequestSchema,
  FilesystemQueryResponseSchema,
} from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { assertProtocolVersion } from '#lib/agent/protocol-version.ts';
import { agentRoutePath } from '#lib/agent/routes.ts';
import { sessionTokenFrom } from '#lib/agent/session-token.ts';
import { ProtocolHeadersSchema } from '#routes/internal/agent/model.ts';
import { AgentServicePlugin, FilesystemServicePlugin, loggerPlugin } from '#services/plugins.ts';

/**
 * What a host should read, if anything.
 *
 * It carries no generation, and that is what keeps this off the desired-state channel: a read is
 * not a state anything converges on, so it must not be able to disturb one. Tenant output took a
 * separate path for the same kind of reason.
 */
export const AgentFilesystemQueryController = new Elysia()
  .use(loggerPlugin('agentFilesystemQueryController'))
  .use(AgentServicePlugin)
  .use(FilesystemServicePlugin)
  .post(
    agentRoutePath(AGENT_ROUTES.filesystemQuery),
    async ({ agentService, filesystemService, body, headers }) => {
      assertProtocolVersion(headers);
      // Resolved and discarded: nothing below needs the host id, but an expired session must not
      // be able to collect another tenant's query.
      await agentService.hostForSession({ sessionToken: sessionTokenFrom(headers) });

      const query = filesystemService.pendingQuery({ servedAppIds: body.servedAppIds });
      return query ? { result: 'query' as const, query } : { result: 'none' as const };
    },
    {
      body: FilesystemQueryRequestSchema,
      headers: ProtocolHeadersSchema,
      response: { [StatusMap.OK]: FilesystemQueryResponseSchema },
    },
  );
