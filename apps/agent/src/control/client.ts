import { createInternalApiClient } from '@repo/api-client/internal';
import {
  AGENT_ROUTES,
  type AgentSession,
  type AgentSessionRequest,
  AgentSessionSchema,
  type DesiredStateRequest,
  type DesiredStateResponse,
  DesiredStateResponseSchema,
  type HostReportedState,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  parseMessage,
  type SecretString,
  TENANT_LOG_CONTENT_TYPE,
} from '@repo/protocol';

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/**
 * A backstop, not the mechanism that ends an upload.
 *
 * The agent ends its own by closing the body, which only works while there is a connection to
 * close: a response that never arrives leaves the caller waiting on it forever, and the log loop
 * awaits one upload at a time, so a host in that state stops shipping output and says nothing.
 *
 * Well above any window the agent picks, so it never pre-empts a healthy upload — it has to be
 * raised if that window is ever brought near it.
 */
const TENANT_LOG_TIMEOUT_MS = 120_000;
const HTTP_UNAUTHORIZED = 401;

export class ControlPlaneError extends Error {
  readonly status: number;

  constructor({ status, route, body }: { status: number; route: string; body: string }) {
    super(`${route} answered ${status}: ${body.slice(0, ControlPlaneError.MAX_BODY)}`);
    this.name = 'ControlPlaneError';
    this.status = status;
  }

  static readonly MAX_BODY = 256;

  get isSessionExpired() {
    return this.status === HTTP_UNAUTHORIZED;
  }
}

type Reply = {
  data: unknown;
  error: { value: unknown } | null;
  status: number;
};

// Eden hands back a failure rather than rejecting, and reports one it never sent as a 503 of
// its own, so a refusal and a host that cannot reach the VPC arrive the same way.
function assertDelivered({ route, reply }: { route: string; reply: Reply }): void {
  if (!reply.error) {
    return;
  }
  throw new ControlPlaneError({
    status: reply.status,
    route,
    body: describeFailure(reply.error.value),
  });
}

function describeFailure(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
}

// `ProtocolHeadersSchema` names one header and admits the rest, but TypeBox writes no index
// signature for that, so the generated call signature names one header and knows nothing of the
// rest. Every header a call sends is therefore assembled here rather than at the call site,
// where the excess-property check would reject the ones the schema allows.
function protocolHeaders({
  sessionToken,
  contentType,
}: {
  sessionToken?: SecretString;
  contentType?: string;
} = {}) {
  return {
    [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
    ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
    ...(contentType ? { 'content-type': contentType } : {}),
  };
}

function requestOptions({ sessionToken }: { sessionToken?: SecretString } = {}) {
  return {
    headers: protocolHeaders({ sessionToken }),
    fetch: { signal: AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS) },
  };
}

/**
 * Every call is an outbound POST through the generated client, so a route, a body or a header
 * the api does not mount is a compile error. Control calls carry one JSON document and validate
 * the reply; tenant logs carry their own long-lived NDJSON request so that stream backpressure
 * never enters the desired-state path.
 *
 * What the generated client cannot describe is the bytes that come back. The two programs ship
 * on different pipelines, so a reply the agent cannot parse is the normal consequence of a
 * rollout rather than an impossible state, and each one is validated before it is believed.
 */
export class ControlPlaneClient {
  readonly #api: ReturnType<typeof createInternalApiClient>;

  constructor({ baseUrl }: { baseUrl: string }) {
    this.#api = createInternalApiClient({ baseUrl: baseUrl.replace(/\/+$/, '') });
  }

  async openSession(request: AgentSessionRequest): Promise<AgentSession> {
    const reply = await this.#api.internal.agent.session.post(request, requestOptions());
    assertDelivered({ route: AGENT_ROUTES.session, reply });
    return parseMessage({ schema: AgentSessionSchema, value: reply.data });
  }

  async fetchDesiredState({
    sessionToken,
    request,
  }: {
    sessionToken: SecretString;
    request: DesiredStateRequest;
  }): Promise<DesiredStateResponse> {
    const reply = await this.#api.internal.agent['desired-state'].post(
      request,
      requestOptions({ sessionToken }),
    );
    assertDelivered({ route: AGENT_ROUTES.desiredState, reply });
    return parseMessage({ schema: DesiredStateResponseSchema, value: reply.data });
  }

  async sendReportedState({
    sessionToken,
    report,
  }: {
    sessionToken: SecretString;
    report: HostReportedState;
  }): Promise<void> {
    const reply = await this.#api.internal.agent['reported-state'].post(
      report,
      requestOptions({ sessionToken }),
    );
    assertDelivered({ route: AGENT_ROUTES.reportedState, reply });
  }

  /**
   * The body is passed as a `RequestInit` rather than as the call's argument, because an object
   * argument is serialised with `JSON.stringify` and a stream does not survive that. Left off,
   * there is nothing for the client to serialise and the stream reaches `fetch` whole — which is
   * the same body the route declares `parse: 'none'` for.
   *
   * The caller's signal is what normally ends this, so the deadline is composed with it rather
   * than replacing it: whichever comes first wins, and cancelling still cancels.
   */
  async streamTenantLogs({
    sessionToken,
    body,
    signal,
  }: {
    sessionToken: SecretString;
    body: ReadableStream<Uint8Array>;
    signal: AbortSignal;
  }): Promise<void> {
    const reply = await this.#api.internal.agent['tenant-logs'].post(undefined, {
      headers: protocolHeaders({ sessionToken, contentType: TENANT_LOG_CONTENT_TYPE }),
      fetch: {
        body,
        signal: AbortSignal.any([signal, AbortSignal.timeout(TENANT_LOG_TIMEOUT_MS)]),
      },
    });
    assertDelivered({ route: AGENT_ROUTES.tenantLogs, reply });
  }
}
