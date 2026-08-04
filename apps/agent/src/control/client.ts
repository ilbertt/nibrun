import { createInternalApiClient } from '@repo/api-client/internal';
import {
  AGENT_ROUTES,
  type AgentSessionRequest,
  AgentSessionSchema,
  type DesiredStateRequest,
  DesiredStateResponseSchema,
  type HostReportedState,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  parseMessage,
  type SecretString,
  TENANT_LOG_CONTENT_TYPE,
} from '@repo/protocol';
import { Data, Effect } from 'effect';
import { decode } from '#lib/protocol.ts';

const REQUEST_TIMEOUT_MS = 30_000;
const HTTP_UNAUTHORIZED = 401;
const NOT_DELIVERED = 0;
const MAX_BODY = 256;

export class ControlPlaneError extends Data.TaggedError('ControlPlaneError')<{
  readonly status: number;
  readonly route: string;
  readonly body: string;
}> {
  get isSessionExpired() {
    return this.status === HTTP_UNAUTHORIZED;
  }

  override get message() {
    return this.status === NOT_DELIVERED
      ? `${this.route} was not reached: ${this.body}`
      : `${this.route} answered ${this.status}: ${this.body}`;
  }
}

type Reply = { data: unknown; error: { value: unknown } | null; status: number };

const describeFailure = (value: unknown) => {
  if (value instanceof Error) {
    return value.message;
  }
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
};

/**
 * `ProtocolHeadersSchema` names one header and admits the rest, but TypeBox writes no index
 * signature for that, so headers are assembled here rather than at a call site where the
 * excess-property check would reject the ones the schema allows.
 */
const protocolHeaders = ({
  sessionToken,
  contentType,
}: {
  sessionToken?: SecretString;
  contentType?: string;
} = {}) => ({
  [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
  ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
  ...(contentType ? { 'content-type': contentType } : {}),
});

/**
 * Every call goes through the generated client, so a route, body or header the api does not
 * mount is a compile error. What it cannot describe is the bytes that come back: the two
 * programs ship on different pipelines, so every reply is validated before it is believed.
 */
export const makeControlPlaneClient = ({ baseUrl }: { baseUrl: string }) => {
  const api = createInternalApiClient({ baseUrl: baseUrl.replace(/\/+$/, '') });

  // Eden hands back a failure rather than rejecting, and reports one it never sent as a 503 of
  // its own, so a refusal and an unreachable VPC arrive the same way.
  const call = ({
    route,
    send,
  }: {
    route: string;
    send: (signal: AbortSignal) => Promise<Reply>;
  }) =>
    Effect.tryPromise({
      try: send,
      catch: (cause) =>
        new ControlPlaneError({ status: NOT_DELIVERED, route, body: describeFailure(cause) }),
    }).pipe(
      Effect.flatMap((reply) =>
        reply.error
          ? new ControlPlaneError({
              status: reply.status,
              route,
              body: describeFailure(reply.error.value).slice(0, MAX_BODY),
            })
          : Effect.succeed(reply.data),
      ),
      Effect.withSpan('controlPlane', { attributes: { route } }),
    );

  const options = (sessionToken?: SecretString) => ({
    headers: protocolHeaders({ sessionToken }),
    fetch: { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  });

  return {
    openSession: (request: AgentSessionRequest) =>
      call({
        route: AGENT_ROUTES.session,
        send: () => api.internal.agent.session.post(request, options()),
      }).pipe(
        Effect.flatMap((value) =>
          decode(() => parseMessage({ schema: AgentSessionSchema, value })),
        ),
      ),

    fetchDesiredState: ({
      sessionToken,
      request,
    }: {
      sessionToken: SecretString;
      request: DesiredStateRequest;
    }) =>
      call({
        route: AGENT_ROUTES.desiredState,
        send: () => api.internal.agent['desired-state'].post(request, options(sessionToken)),
      }).pipe(
        Effect.flatMap((value) =>
          decode(() => parseMessage({ schema: DesiredStateResponseSchema, value })),
        ),
      ),

    sendReportedState: ({
      sessionToken,
      report,
    }: {
      sessionToken: SecretString;
      report: HostReportedState;
    }) =>
      Effect.asVoid(
        call({
          route: AGENT_ROUTES.reportedState,
          send: () => api.internal.agent['reported-state'].post(report, options(sessionToken)),
        }),
      ),

    /**
     * The body travels as a `RequestInit` rather than as the call's argument, which is
     * `JSON.stringify`d and would not survive it. Interrupting this effect aborts the request,
     * which is how an upload the agent no longer wants is ended.
     */
    streamTenantLogs: ({
      sessionToken,
      body,
    }: {
      sessionToken: SecretString;
      body: ReadableStream<Uint8Array>;
    }) =>
      Effect.asVoid(
        call({
          route: AGENT_ROUTES.tenantLogs,
          send: (signal) =>
            api.internal.agent['tenant-logs'].post(undefined, {
              headers: protocolHeaders({ sessionToken, contentType: TENANT_LOG_CONTENT_TYPE }),
              fetch: { body, signal },
            }),
        }),
      ),
  };
};

export type ControlPlaneClient = ReturnType<typeof makeControlPlaneClient>;
