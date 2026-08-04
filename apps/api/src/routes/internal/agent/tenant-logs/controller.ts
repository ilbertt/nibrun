import { AGENT_ROUTES } from '@repo/protocol';
import { Elysia, StatusMap, t } from 'elysia';
import { assertProtocolVersion } from '#lib/agent/protocol-version.ts';
import { sessionTokenFrom } from '#lib/agent/session-token.ts';
import { tenantLogEvents } from '#lib/agent/tenant-logs.ts';
import { ProtocolHeadersSchema } from '#routes/internal/agent/model.ts';
import { AgentServicePlugin, loggerPlugin } from '#services/plugins.ts';

// Bun closes a request that has gone ten seconds without data, and this one is quiet whenever the
// apps on a host are: silence here is the resting state, not a stall. Raised for this request
// alone rather than for the listener, so every other route still drops a stalled client at the
// default.
//
// A backstop rather than the mechanism: the agent ends each upload itself, well inside this, and
// keeps the connection from going idle in between. What this catches is a host that stopped
// existing without closing anything.
const TENANT_LOG_IDLE_TIMEOUT_SECONDS = 60;

// `parse: 'none'` is what makes this route possible: the default parser reads a body to its end
// before the handler runs, and this body does not have one until the host stops sending. The
// reply comes after the stream, never on its headers — the agent counts a response as the end of
// its upload, so answering early would only make it reconnect.
export const AgentTenantLogsController = new Elysia()
  .use(loggerPlugin('agentTenantLogsController'))
  .use(AgentServicePlugin)
  .post(
    AGENT_ROUTES.tenantLogs,
    async ({ agentService, request, headers, status, server }) => {
      server?.timeout(request, TENANT_LOG_IDLE_TIMEOUT_SECONDS);
      assertProtocolVersion(headers);
      const hostId = await agentService.hostForSession({ sessionToken: sessionTokenFrom(headers) });
      await agentService.ingestTenantLogs({
        hostId,
        events: tenantLogEvents({ body: request.body }),
      });
      return status(StatusMap['No Content'], undefined);
    },
    {
      parse: 'none',
      headers: ProtocolHeadersSchema,
      response: { [StatusMap['No Content']]: t.Void() },
    },
  );
