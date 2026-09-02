import { createInternalApiClient } from '@repo/api-client/internal';
import {
  AGENT_ROUTES,
  type AgentSessionRequest,
  AgentSessionSchema,
  type DesiredStateRequest,
  DesiredStateResponseSchema,
  type FilesystemQueryRequest,
  FilesystemQueryResponseSchema,
  type FilesystemQueryResult,
  type HostReportedState,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  parseMessage,
  type SecretString,
} from '@repo/protocol';
import { Data, Effect } from 'effect';
import { decode } from '#lib/protocol.ts';

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * The one route the api answers slowly on purpose: a poll for a read is held there until a read
 * arrives or its own 25s hold expires, so the ordinary ceiling would abandon every idle poll a
 * few seconds before the reply it was waiting for. Above the hold with room for the round trip,
 * and never below it — a client that gives up first turns an idle fleet into a retry loop and
 * loses every read handed to a host on the way out.
 */
const FILESYSTEM_QUERY_TIMEOUT_MS = 45_000;

/** Desired state is held the same way and for the same reasons, so it is given the same room. */
const DESIRED_STATE_TIMEOUT_MS = FILESYSTEM_QUERY_TIMEOUT_MS;
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
const protocolHeaders = ({ sessionToken }: { sessionToken?: SecretString } = {}) => ({
  [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
  ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
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

  const options = ({
    sessionToken,
    timeoutMs = REQUEST_TIMEOUT_MS,
  }: {
    sessionToken?: SecretString;
    timeoutMs?: number;
  } = {}) => ({
    headers: protocolHeaders({ sessionToken }),
    fetch: { signal: AbortSignal.timeout(timeoutMs) },
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
        send: () =>
          api.internal.agent['desired-state'].post(
            request,
            options({ sessionToken, timeoutMs: DESIRED_STATE_TIMEOUT_MS }),
          ),
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
          send: () => api.internal.agent['reported-state'].post(report, options({ sessionToken })),
        }),
      ),

    fetchFilesystemQuery: ({
      sessionToken,
      request,
    }: {
      sessionToken: SecretString;
      request: FilesystemQueryRequest;
    }) =>
      call({
        route: AGENT_ROUTES.filesystemQuery,
        send: () =>
          api.internal.agent['filesystem-query'].post(
            request,
            options({ sessionToken, timeoutMs: FILESYSTEM_QUERY_TIMEOUT_MS }),
          ),
      }).pipe(
        Effect.flatMap((value) =>
          decode(() => parseMessage({ schema: FilesystemQueryResponseSchema, value })),
        ),
      ),

    sendFilesystemQueryResult: ({
      sessionToken,
      result,
    }: {
      sessionToken: SecretString;
      result: FilesystemQueryResult;
    }) =>
      Effect.asVoid(
        call({
          route: AGENT_ROUTES.filesystemQueryResult,
          send: () =>
            api.internal.agent['filesystem-query-result'].post(result, options({ sessionToken })),
        }),
      ),
  };
};

export type ControlPlaneClient = ReturnType<typeof makeControlPlaneClient>;
