import { AGENT_ROUTES, CronQueryResultSchema } from '@repo/protocol';
import { Elysia, StatusMap, t } from 'elysia';
import { assertProtocolVersion } from '#lib/agent/protocol-version.ts';
import { agentRoutePath } from '#lib/agent/routes.ts';
import { sessionTokenFrom } from '#lib/agent/session-token.ts';
import { ProtocolHeadersSchema } from '#routes/internal/agent/model.ts';
import { AgentServicePlugin, CronsServicePlugin, loggerPlugin } from '#services/plugins.ts';

export const AgentCronQueryResultController = new Elysia()
  .use(loggerPlugin('agentCronQueryResultController'))
  .use(AgentServicePlugin)
  .use(CronsServicePlugin)
  .post(
    agentRoutePath(AGENT_ROUTES.cronQueryResult),
    async ({ agentService, cronsService, body, headers, status }) => {
      assertProtocolVersion(headers);
      const hostId = await agentService.hostForSession({ sessionToken: sessionTokenFrom(headers) });
      cronsService.acceptResult({ ...body, hostId });
      return status(StatusMap['No Content'], undefined);
    },
    {
      body: CronQueryResultSchema,
      headers: ProtocolHeadersSchema,
      response: { [StatusMap['No Content']]: t.Void() },
    },
  );
