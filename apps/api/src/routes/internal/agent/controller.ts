import {
  AGENT_API_PREFIX,
  AGENT_ROUTES,
  AgentSessionRequestSchema,
  AgentSessionSchema,
  DesiredStateRequestSchema,
  DesiredStateResponseSchema,
  HostReportedStateSchema,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  ReportedStateResponseSchema,
} from '@repo/protocol';
import { Elysia, StatusMap, t } from 'elysia';
import { BadRequestError, UnauthorizedError } from '#lib/errors.ts';
import { RoutePrefix } from '#lib/routes/prefixes.ts';
import { AgentServicePlugin, loggerPlugin } from '#services/plugins.ts';

// The protocol owns the whole path. This controller owns only the segment below
// the prefix its parent applies, derived from that one constant so the two
// cannot drift.
const AGENT_PREFIX = AGENT_API_PREFIX.slice(RoutePrefix.Internal.length);

const BEARER_PREFIX = 'Bearer ';

// Sent on every request so the older side can say so, rather than failing
// somewhere further in where the cause is no longer visible.
const ProtocolHeadersSchema = t.Object(
  { [PROTOCOL_VERSION_HEADER]: t.String() },
  { additionalProperties: true },
);

const rejectSkew = (headers: Record<string, string | undefined>) => {
  const version = Number(headers[PROTOCOL_VERSION_HEADER]);
  if (version !== PROTOCOL_VERSION) {
    throw new BadRequestError(
      `Agent speaks protocol ${headers[PROTOCOL_VERSION_HEADER]}, this control plane speaks ${PROTOCOL_VERSION}.`,
    );
  }
};

export const AgentController = new Elysia({ prefix: AGENT_PREFIX })
  .use(loggerPlugin('agentController'))
  .use(AgentServicePlugin)
  .post(
    AGENT_ROUTES.session,
    async ({ agentService, body, headers, status }) => {
      rejectSkew(headers);
      return status(StatusMap.OK, await agentService.openSession(body));
    },
    {
      body: AgentSessionRequestSchema,
      headers: ProtocolHeadersSchema,
      response: { [StatusMap.OK]: AgentSessionSchema },
    },
  )
  // A read behind POST: a long poll is not a cacheable GET, and a body keeps the
  // protocol to one wire format and one validation path.
  .post(
    AGENT_ROUTES.desiredState,
    async ({ agentService, body, headers, status }) => {
      rejectSkew(headers);
      const hostId = await agentService.hostForSession({ sessionToken: bearer(headers) });
      const state = await agentService.desiredState({ hostId });

      // Answered immediately rather than held open. Long-polling is what makes a
      // change reach a host promptly, and it belongs here once something can
      // change; until then holding the request open would only add latency to an
      // answer that is already final.
      return body.knownGeneration === state.generation
        ? { result: 'unchanged' as const, generation: state.generation }
        : { result: 'changed' as const, state };
    },
    {
      body: DesiredStateRequestSchema,
      headers: ProtocolHeadersSchema,
      response: { [StatusMap.OK]: DesiredStateResponseSchema },
    },
  )
  .post(
    AGENT_ROUTES.reportedState,
    async ({ agentService, body, headers, status }) => {
      rejectSkew(headers);
      const generation = await agentService.acceptReport({ reported: body });
      return status(StatusMap.OK, { generation });
    },
    {
      body: HostReportedStateSchema,
      headers: ProtocolHeadersSchema,
      response: { [StatusMap.OK]: ReportedStateResponseSchema },
    },
  );

function bearer(headers: Record<string, string | undefined>): string {
  const authorization = headers.authorization;
  if (!authorization?.startsWith(BEARER_PREFIX)) {
    throw new UnauthorizedError('Missing session.');
  }
  return authorization.slice(BEARER_PREFIX.length);
}
