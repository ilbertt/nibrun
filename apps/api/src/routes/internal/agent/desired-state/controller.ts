import {
  AGENT_ROUTES,
  DesiredStateRequestSchema,
  DesiredStateResponseSchema,
} from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { assertProtocolVersion } from '#lib/agent/protocol-version.ts';
import { agentRoutePath } from '#lib/agent/routes.ts';
import { sessionTokenFrom } from '#lib/agent/session-token.ts';
import { ProtocolHeadersSchema } from '#routes/internal/agent/model.ts';
import { AgentServicePlugin, loggerPlugin } from '#services/plugins.ts';

/**
 * The longest a host with nothing owed to it is left holding this open.
 *
 * The same ceiling `filesystem-query` holds under and for the same reasons: Bun drops a
 * connection nothing has travelled on for 30s, which is Elysia's default `idleTimeout`, and a
 * poll that ends as an error is one a host backs off from rather than reopens. A host may ask for
 * less and is given what it asked for; one that asks for more is held for this.
 */
const MAX_HOLD_SECONDS = 25;
const MS_PER_SECOND = 1000;
const NO_HOLD_MS = 0;

/** What an agent that named no hold gets: a signal already fired, so nothing waits on it. */
function holdMsFor(waitSeconds: number | undefined): number {
  return waitSeconds === undefined
    ? NO_HOLD_MS
    : Math.min(waitSeconds, MAX_HOLD_SECONDS) * MS_PER_SECOND;
}

// A read behind POST: a request body keeps the protocol to one wire format and one
// validation path.
export const AgentDesiredStateController = new Elysia()
  .use(loggerPlugin('agentDesiredStateController'))
  .use(AgentServicePlugin)
  .post(
    agentRoutePath(AGENT_ROUTES.desiredState),
    async ({ agentService, body, headers, request }) => {
      assertProtocolVersion(headers);
      const sessionToken = sessionTokenFrom(headers);
      // Before the hold rather than after it, so a host parked here on an expired session is
      // turned away now instead of on the poll that follows the one it is holding.
      const hostId = await agentService.hostForSession({ sessionToken });

      return await agentService.desiredState({
        hostId,
        sessionToken,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(holdMsFor(body.waitSeconds))]),
      });
    },
    {
      body: DesiredStateRequestSchema,
      headers: ProtocolHeadersSchema,
      response: { [StatusMap.OK]: DesiredStateResponseSchema },
    },
  );
