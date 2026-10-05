import { AGENT_ROUTES, SqliteQueryResultSchema } from '@repo/protocol';
import { Elysia, StatusMap, t } from 'elysia';
import { assertProtocolVersion } from '#lib/agent/protocol-version.ts';
import { agentRoutePath } from '#lib/agent/routes.ts';
import { sessionTokenFrom } from '#lib/agent/session-token.ts';
import { ProtocolHeadersSchema } from '#routes/internal/agent/model.ts';
import { AgentServicePlugin, loggerPlugin, SqliteRelayServicePlugin } from '#services/plugins.ts';

export const AgentSqliteQueryResultController = new Elysia()
  .use(loggerPlugin('agentSqliteQueryResultController'))
  .use(AgentServicePlugin)
  .use(SqliteRelayServicePlugin)
  .post(
    agentRoutePath(AGENT_ROUTES.sqliteQueryResult),
    async function answer({ agentService, sqliteRelayService, body, headers, status }) {
      assertProtocolVersion(headers);
      const hostId = await agentService.hostForSession({ sessionToken: sessionTokenFrom(headers) });
      sqliteRelayService.acceptResult({ ...body, hostId });
      return status(StatusMap['No Content'], undefined);
    },
    {
      body: SqliteQueryResultSchema,
      headers: ProtocolHeadersSchema,
      response: { [StatusMap['No Content']]: t.Void() },
    },
  );
