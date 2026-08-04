import {
  AGENT_ROUTES,
  DesiredStateRequestSchema,
  DesiredStateResponseSchema,
} from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { assertProtocolVersion } from '#lib/agent/protocol-version.ts';
import { sessionTokenFrom } from '#lib/agent/session-token.ts';
import { ProtocolHeadersSchema } from '#routes/internal/agent/model.ts';
import { AgentServicePlugin, loggerPlugin } from '#services/plugins.ts';

// A read behind POST: a request body keeps the protocol to one wire format and one
// validation path.
export const AgentDesiredStateController = new Elysia()
  .use(loggerPlugin('agentDesiredStateController'))
  .use(AgentServicePlugin)
  .post(
    AGENT_ROUTES.desiredState,
    async ({ agentService, body, headers }) => {
      assertProtocolVersion(headers);
      const hostId = await agentService.hostForSession({ sessionToken: sessionTokenFrom(headers) });
      const state = await agentService.desiredState({ hostId });

      return body.knownGeneration === state.generation
        ? { result: 'unchanged' as const, generation: state.generation }
        : { result: 'changed' as const, state };
    },
    {
      body: DesiredStateRequestSchema,
      headers: ProtocolHeadersSchema,
      response: { [StatusMap.OK]: DesiredStateResponseSchema },
    },
  );
