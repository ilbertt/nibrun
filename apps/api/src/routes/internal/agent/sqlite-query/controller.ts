import {
  AGENT_ROUTES,
  SqliteQueryRequestSchema,
  type SqliteQueryResponse,
  SqliteQueryResponseSchema,
} from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { assertProtocolVersion } from '#lib/agent/protocol-version.ts';
import { agentRoutePath } from '#lib/agent/routes.ts';
import { sessionTokenFrom } from '#lib/agent/session-token.ts';
import { ProtocolHeadersSchema } from '#routes/internal/agent/model.ts';
import { AgentServicePlugin, loggerPlugin, SqliteRelayServicePlugin } from '#services/plugins.ts';

const HOLD_MS = 25000;

export const AgentSqliteQueryController = new Elysia()
  .use(loggerPlugin('agentSqliteQueryController'))
  .use(AgentServicePlugin)
  .use(SqliteRelayServicePlugin)
  .post(
    agentRoutePath(AGENT_ROUTES.sqliteQuery),
    async function query({ agentService, sqliteRelayService, body, headers, request }) {
      assertProtocolVersion(headers);
      const hostId = await agentService.hostForSession({ sessionToken: sessionTokenFrom(headers) });
      const query = await sqliteRelayService.pendingQuery({
        ...body,
        hostId,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(HOLD_MS)]),
      });
      const response: SqliteQueryResponse = query ? { result: 'query', query } : { result: 'none' };
      return Response.json(response);
    },
    {
      body: SqliteQueryRequestSchema,
      headers: ProtocolHeadersSchema,
      response: { [StatusMap.OK]: SqliteQueryResponseSchema },
    },
  );
