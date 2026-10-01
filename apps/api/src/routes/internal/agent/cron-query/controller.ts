import { AGENT_ROUTES, CronQueryRequestSchema, CronQueryResponseSchema } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { assertProtocolVersion } from '#lib/agent/protocol-version.ts';
import { agentRoutePath } from '#lib/agent/routes.ts';
import { sessionTokenFrom } from '#lib/agent/session-token.ts';
import { ProtocolHeadersSchema } from '#routes/internal/agent/model.ts';
import { AgentServicePlugin, CronsServicePlugin, loggerPlugin } from '#services/plugins.ts';

// Expire below Bun's 30-second idle timeout; the agent allows 45 seconds for this held poll.
const HOLD_MS = 25_000;

export const AgentCronQueryController = new Elysia()
  .use(loggerPlugin('agentCronQueryController'))
  .use(AgentServicePlugin)
  .use(CronsServicePlugin)
  .post(
    agentRoutePath(AGENT_ROUTES.cronQuery),
    async ({ agentService, cronsService, body, headers, request }) => {
      assertProtocolVersion(headers);
      const hostId = await agentService.hostForSession({ sessionToken: sessionTokenFrom(headers) });
      const query = await cronsService.pendingQuery({
        ...body,
        hostId,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(HOLD_MS)]),
      });
      return query ? { result: 'query' as const, query } : { result: 'none' as const };
    },
    {
      body: CronQueryRequestSchema,
      headers: ProtocolHeadersSchema,
      response: { [StatusMap.OK]: CronQueryResponseSchema },
    },
  );
