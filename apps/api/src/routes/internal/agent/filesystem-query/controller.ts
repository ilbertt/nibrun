import {
  AGENT_ROUTES,
  FilesystemQueryRequestSchema,
  FilesystemQueryResponseSchema,
} from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { assertProtocolVersion } from '#lib/agent/protocol-version.ts';
import { agentRoutePath } from '#lib/agent/routes.ts';
import { sessionTokenFrom } from '#lib/agent/session-token.ts';
import { ProtocolHeadersSchema } from '#routes/internal/agent/model.ts';
import { AgentServicePlugin, FilesystemServicePlugin, loggerPlugin } from '#services/plugins.ts';

/**
 * How long a host with nothing to read is left holding this request open.
 *
 * The direction of dialling is unchanged and cannot change — the host calls the control plane and
 * nothing here ever connects to a host — so a read reaches a host either on a request the host is
 * already holding open or one poll interval later. Holding it is what makes the first the usual
 * case: what a person browsing waits for becomes a round trip rather than the rest of somebody
 * else's timer.
 *
 * It has to expire below every ceiling that can close this request from outside, because a poll
 * that ends as an error is one the host backs off from rather than reopens. Two sit above it: Bun
 * drops a connection nothing has travelled on for 30s — Elysia's default `idleTimeout` — and the
 * agent gives this one route 45s before it stops waiting for a reply.
 */
const HOLD_SECONDS = 25;
const MS_PER_SECOND = 1000;
const HOLD_MS = HOLD_SECONDS * MS_PER_SECOND;

/**
 * What a host should read, if anything.
 *
 * It carries no generation, and that is what keeps this off the desired-state channel: a read is
 * not a state anything converges on, so it must not be able to disturb one. Tenant output took a
 * separate path for the same kind of reason.
 */
export const AgentFilesystemQueryController = new Elysia()
  .use(loggerPlugin('agentFilesystemQueryController'))
  .use(AgentServicePlugin)
  .use(FilesystemServicePlugin)
  .post(
    agentRoutePath(AGENT_ROUTES.filesystemQuery),
    async ({ agentService, filesystemService, body, headers, request }) => {
      assertProtocolVersion(headers);
      // Resolved and discarded: nothing below needs the host id, but an expired session must not
      // be able to collect another tenant's query. Decided before the wait, so a session that
      // expires while a host is parked is caught on the poll after this one and not this one.
      await agentService.hostForSession({ sessionToken: sessionTokenFrom(headers) });

      const query = await filesystemService.pendingQuery({
        servedAppIds: body.servedAppIds,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(HOLD_MS)]),
      });
      return query ? { result: 'query' as const, query } : { result: 'none' as const };
    },
    {
      body: FilesystemQueryRequestSchema,
      headers: ProtocolHeadersSchema,
      response: { [StatusMap.OK]: FilesystemQueryResponseSchema },
    },
  );
