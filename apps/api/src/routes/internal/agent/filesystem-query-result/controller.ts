import { AGENT_ROUTES, FilesystemQueryResultSchema } from '@repo/protocol';
import { Elysia, StatusMap, t } from 'elysia';
import { assertProtocolVersion } from '#lib/agent/protocol-version.ts';
import { agentRoutePath } from '#lib/agent/routes.ts';
import { sessionTokenFrom } from '#lib/agent/session-token.ts';
import { ProtocolHeadersSchema } from '#routes/internal/agent/model.ts';
import { AgentServicePlugin, FilesystemServicePlugin, loggerPlugin } from '#services/plugins.ts';

/**
 * What the host read. Nothing comes back, and nothing is waiting on it yet — the answer is
 * logged, which is what says a host can read a live tenant filesystem at all.
 */
export const AgentFilesystemQueryResultController = new Elysia()
  .use(loggerPlugin('agentFilesystemQueryResultController'))
  .use(AgentServicePlugin)
  .use(FilesystemServicePlugin)
  .post(
    agentRoutePath(AGENT_ROUTES.filesystemQueryResult),
    async ({ agentService, filesystemService, body, headers, status }) => {
      assertProtocolVersion(headers);
      await agentService.hostForSession({ sessionToken: sessionTokenFrom(headers) });

      filesystemService.acceptResult(body);
      return status(StatusMap['No Content'], undefined);
    },
    {
      body: FilesystemQueryResultSchema,
      headers: ProtocolHeadersSchema,
      response: { [StatusMap['No Content']]: t.Void() },
    },
  );
