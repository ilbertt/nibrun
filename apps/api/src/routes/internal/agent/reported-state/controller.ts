import { AGENT_ROUTES, HostReportedStateSchema } from '@repo/protocol';
import { Elysia, StatusMap, t } from 'elysia';
import { assertProtocolVersion } from '#lib/agent/protocol-version.ts';
import { agentRoutePath } from '#lib/agent/routes.ts';
import { ProtocolHeadersSchema } from '#routes/internal/agent/model.ts';
import { AgentServicePlugin, loggerPlugin } from '#services/plugins.ts';

// Nothing comes back. The desired-state poll is the only channel carrying a generation, so a
// host learns it is behind in exactly one place — a second copy on this reply would be a second
// thing to keep true, and it could only ever repeat what the next poll says a second later.
export const AgentReportedStateController = new Elysia()
  .use(loggerPlugin('agentReportedStateController'))
  .use(AgentServicePlugin)
  .post(
    agentRoutePath(AGENT_ROUTES.reportedState),
    async ({ agentService, body, headers, status }) => {
      assertProtocolVersion(headers);
      await agentService.acceptReport({ reported: body });
      return status(StatusMap['No Content'], undefined);
    },
    {
      body: HostReportedStateSchema,
      headers: ProtocolHeadersSchema,
      response: { [StatusMap['No Content']]: t.Void() },
    },
  );
