import {
  AGENT_API_PREFIX,
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
const HTTP_UNAUTHORIZED = 401;

export type FetchLike = typeof fetch;

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

/**
 * Every call is an outbound POST. Control calls carry one JSON document and validate the reply;
 * tenant logs use their own long-lived NDJSON request so that stream backpressure never enters
 * the desired-state path.
 */
export class ControlPlaneClient {
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;

  constructor({ baseUrl, fetchImpl = fetch }: { baseUrl: string; fetchImpl?: FetchLike }) {
    this.#baseUrl = baseUrl.replace(/\/+$/, '');
    this.#fetch = fetchImpl;
  }

  async openSession(request: AgentSessionRequest): Promise<AgentSession> {
    const response = await this.#post({
      route: AGENT_ROUTES.session,
      body: request,
    });
    return parseMessage({ schema: AgentSessionSchema, value: await response.json() });
  }

  async fetchDesiredState({
    sessionToken,
    request,
  }: {
    sessionToken: SecretString;
    request: DesiredStateRequest;
  }): Promise<DesiredStateResponse> {
    const response = await this.#post({
      route: AGENT_ROUTES.desiredState,
      body: request,
      sessionToken,
    });
    return parseMessage({ schema: DesiredStateResponseSchema, value: await response.json() });
  }

  async sendReportedState({
    sessionToken,
    report,
  }: {
    sessionToken: SecretString;
    report: HostReportedState;
  }): Promise<void> {
    await this.#post({
      route: AGENT_ROUTES.reportedState,
      body: report,
      sessionToken,
    });
  }

  async streamTenantLogs({
    sessionToken,
    body,
    signal,
  }: {
    sessionToken: SecretString;
    body: ReadableStream<Uint8Array>;
    signal: AbortSignal;
  }): Promise<void> {
    const route = AGENT_ROUTES.tenantLogs;
    const response = await this.#fetch(`${this.#baseUrl}${AGENT_API_PREFIX}${route}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${sessionToken}`,
        'content-type': TENANT_LOG_CONTENT_TYPE,
        [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
      },
      body,
      signal,
    });
    if (!response.ok) {
      throw new ControlPlaneError({ status: response.status, route, body: await response.text() });
    }
  }

  async #post({
    route,
    body,
    sessionToken,
  }: {
    route: string;
    body: unknown;
    sessionToken?: SecretString;
  }): Promise<Response> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
    };
    if (sessionToken) {
      headers.authorization = `Bearer ${sessionToken}`;
    }
    const response = await this.#fetch(`${this.#baseUrl}${AGENT_API_PREFIX}${route}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new ControlPlaneError({
        status: response.status,
        route,
        body: await response.text(),
      });
    }
    return response;
  }
}
