import { AGENT_ROUTES, AgentSessionRequestSchema, AgentSessionSchema } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { assertProtocolVersion } from '#lib/agent/protocol-version.ts';
import { agentRoutePath } from '#lib/agent/routes.ts';
import { ProtocolHeadersSchema } from '#routes/internal/agent/model.ts';
import { AgentServicePlugin, loggerPlugin } from '#services/plugins.ts';

// The only route reached without a session, because it is the one that issues it.
export const AgentSessionController = new Elysia()
  .use(loggerPlugin('agentSessionController'))
  .use(AgentServicePlugin)
  .post(
    agentRoutePath(AGENT_ROUTES.session),
    async ({ agentService, body, headers, status }) => {
      assertProtocolVersion(headers);
      return status(StatusMap.OK, await agentService.openSession(body));
    },
    {
      body: AgentSessionRequestSchema,
      headers: ProtocolHeadersSchema,
      response: { [StatusMap.OK]: AgentSessionSchema },
    },
  );
