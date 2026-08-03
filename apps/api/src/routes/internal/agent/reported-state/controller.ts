import { AGENT_ROUTES, HostReportedStateSchema, ReportedStateResponseSchema } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { assertProtocolVersion } from '#lib/agent/protocol-version.ts';
import { ProtocolHeadersSchema } from '#routes/internal/agent/model.ts';
import { AgentServicePlugin, loggerPlugin } from '#services/plugins.ts';

export const AgentReportedStateController = new Elysia()
  .use(loggerPlugin('agentReportedStateController'))
  .use(AgentServicePlugin)
  .post(
    AGENT_ROUTES.reportedState,
    async ({ agentService, body, headers, status }) => {
      assertProtocolVersion(headers);
      // Answered with the generation current at the time, so an agent that has
      // fallen behind learns it from the report it was already making rather than
      // from its next poll.
      const generation = await agentService.acceptReport({ reported: body });
      return status(StatusMap.OK, { generation });
    },
    {
      body: HostReportedStateSchema,
      headers: ProtocolHeadersSchema,
      response: { [StatusMap.OK]: ReportedStateResponseSchema },
    },
  );
