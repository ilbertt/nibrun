import { beforeAll, describe, expect, test } from 'bun:test';
import {
  AGENT_API_PREFIX,
  AGENT_ROUTES,
  type AgentSessionRequest,
  AgentSessionSchema,
  DesiredStateResponseSchema,
  type HostCapacity,
  type HostReportedState,
  type HostVersions,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  parseMessage,
  TENANT_LOG_CONTENT_TYPE,
} from '@repo/protocol';
import { StatusMap } from 'elysia';

// What an agent that has never polled reports knowing, so this is the case that
// has to yield state rather than `unchanged`.
const FIRST_POLL_GENERATION = 0;

const BETTER_AUTH_SECRET_LENGTH = 32;
const PROTOCOL_VERSION_SKEW = 1;
// Long enough for a reply to have been written if the route were going to write one early.
const SETTLE_MS = 50;

// The api reads its configuration when the service graph is constructed, so the
// environment has to exist before the app module is imported.
const REQUIRED_ENV = {
  DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none',
  BETTER_AUTH_SECRET: 'x'.repeat(BETTER_AUTH_SECRET_LENGTH),
  GITHUB_CLIENT_ID: 'test',
  GITHUB_CLIENT_SECRET: 'test',
  S3_ENDPOINT: 'http://127.0.0.1:1',
  ARTIFACTS_BUCKET: 'test',
  S3_ACCESS_KEY_ID: 'test',
  S3_SECRET_ACCESS_KEY: 'test',
};

let app: { handle: (request: Request) => Promise<Response> };

beforeAll(async () => {
  Object.assign(process.env, REQUIRED_ENV);
  const { createApp } = await import('#app.ts');
  app = createApp();
});

const versions: HostVersions = {
  agent: 'abc123',
  guestImage: '6.1.180-436861c7d163',
  zerofs: 'v2.2.1',
  firecracker: 'v1.16.1',
} as HostVersions;

const capacity: HostCapacity = { vcpuCount: 2, memoryMib: 8192, cacheBytes: 100_000_000_000 };

function post({
  route,
  body,
  sessionToken,
}: {
  route: string;
  body: unknown;
  sessionToken?: string;
}) {
  return app.handle(
    new Request(`http://control-plane${AGENT_API_PREFIX}${route}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
        ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

// Every response is read back through the protocol's own schema, so the test
// fails if the api answers something the agent could not have parsed — the same
// check the agent performs, run from the other side.
async function readSession(response: Response) {
  return parseMessage({ schema: AgentSessionSchema, value: await response.json() });
}

async function readDesired(response: Response) {
  return parseMessage({ schema: DesiredStateResponseSchema, value: await response.json() });
}

function postTenantLogs({
  body,
  sessionToken,
}: {
  body: string | ReadableStream<Uint8Array>;
  sessionToken?: string;
}) {
  return app.handle(
    new Request(`http://control-plane${AGENT_API_PREFIX}${AGENT_ROUTES.tenantLogs}`, {
      method: 'POST',
      headers: {
        'content-type': TENANT_LOG_CONTENT_TYPE,
        [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
        ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
      },
      body,
      duplex: 'half',
    } as RequestInit),
  );
}

function tenantLogLine(overrides: Record<string, unknown> = {}): string {
  return `${JSON.stringify({
    kind: 'data',
    sourceId: 'source-1',
    sequence: 0,
    observedAt: new Date().toISOString(),
    appId: 'app-pocketbase',
    deploymentId: 'dep-pocketbase-2',
    instanceId: 'inst-pocketbase-1',
    stream: 'stdout',
    text: 'listening on 0.0.0.0:8090\n',
    ...overrides,
  })}\n`;
}

function openSession(overrides: Partial<AgentSessionRequest> = {}) {
  return post({
    route: AGENT_ROUTES.session,
    body: { versions, capacity, ...overrides },
  });
}

describe('an agent can register and be told what to run', () => {
  test('a session names the host and how often to come back', async () => {
    const session = await readSession(await openSession());

    expect(session.hostId).toBeTruthy();
    expect(session.sessionToken).toBeTruthy();
    expect(session.poll.minIntervalMs).toBeGreaterThan(0);
  });

  // The endpoint carries no credential. What keeps it closed is that nothing outside the VPC
  // can address it and no tenant can route to it, so a test asserting a rejection here would
  // be asserting a defence this design deliberately does not have.
  test('a session is granted on reachability alone', async () => {
    expect((await openSession()).status).toBe(StatusMap.OK);
  });

  test('a host that has never polled is told its state, not that nothing changed', async () => {
    const session = await readSession(await openSession());
    const response = await post({
      route: AGENT_ROUTES.desiredState,
      body: { knownGeneration: FIRST_POLL_GENERATION },
      sessionToken: session.sessionToken,
    });

    const body = await readDesired(response);
    expect(body.result).toBe('changed');
    // Desired state carries no host id, so a host can only ever be told about itself.
    expect(body.result === 'changed' && body.state.hostId).toBe(session.hostId);
  });

  test('and told nothing when it is already current', async () => {
    const session = await readSession(await openSession());
    const first = await readDesired(
      await post({
        route: AGENT_ROUTES.desiredState,
        body: { knownGeneration: FIRST_POLL_GENERATION },
        sessionToken: session.sessionToken,
      }),
    );
    if (first.result !== 'changed') {
      throw new Error('A host that has never polled must be given state to converge to.');
    }

    const second = await readDesired(
      await post({
        route: AGENT_ROUTES.desiredState,
        body: { knownGeneration: first.state.generation },
        sessionToken: session.sessionToken,
      }),
    );

    expect(second).toEqual({ result: 'unchanged', generation: first.state.generation });
  });

  test('a report is accepted without being answered', async () => {
    const session = await readSession(await openSession());
    const report = {
      hostId: session.hostId,
      observedGeneration: 0,
      reportedAt: new Date().toISOString(),
      state: 'ready',
      capacity,
      allocatable: capacity,
      versions,
      volumes: [],
      instances: [],
      checkpoints: [],
      exports: [],
    } as unknown as HostReportedState;

    const response = await post({
      route: AGENT_ROUTES.reportedState,
      body: report,
      sessionToken: session.sessionToken,
    });

    // No body at all: the desired-state poll is the only place a generation travels, so there is
    // nothing here for an agent to read and nothing to keep in step with it.
    expect(response.status).toBe(StatusMap['No Content']);
    expect(await response.text()).toBe('');
  });
});

describe('an agent streams tenant output on a request of its own', () => {
  test('a stream of events is accepted once the host stops sending', async () => {
    const session = await readSession(await openSession());
    const response = await postTenantLogs({
      body: `${tenantLogLine()}${tenantLogLine({ sequence: 1, stream: 'stderr' })}`,
      sessionToken: session.sessionToken,
    });

    expect(response.status).toBe(StatusMap['No Content']);
  });

  // The agent reads a response as the end of its upload and opens the next one, so answering
  // while the body is still open is what turns a working stream into a reconnect loop. This is
  // the same contract its own client test pins, asserted from the side that has to honour it.
  test('nothing is answered while the host is still sending', async () => {
    const session = await readSession(await openSession());
    let send!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        send = controller;
      },
    });

    let answered = false;
    const response = postTenantLogs({ body, sessionToken: session.sessionToken }).then((value) => {
      answered = true;
      return value;
    });

    send.enqueue(new TextEncoder().encode(tenantLogLine()));
    await Bun.sleep(SETTLE_MS);
    expect(answered).toBe(false);

    send.close();
    expect((await response).status).toBe(StatusMap['No Content']);
  });

  // Every event on this stream was built by the agent out of pieces it had already validated, so
  // one that does not parse is skew or a bug rather than a tenant writing something odd. Refusing
  // is what makes either visible; skipping would leave a stream that looks like it works.
  test('a line that is not an event is refused rather than skipped', async () => {
    const session = await readSession(await openSession());
    const response = await postTenantLogs({
      body: `${tenantLogLine()}{"kind":"data"}\n`,
      sessionToken: session.sessionToken,
    });

    expect(response.status).toBe(StatusMap['Bad Request']);
  });

  // A host stops sending by going away far more often than by closing politely — an agent
  // restart, a deploy, a timeout in between. Answering that with a fault makes the agent log a
  // failure for its own reconnect, and makes a 500 the ordinary outcome of this route.
  test('a host that goes away mid-stream ends it rather than failing it', async () => {
    const session = await readSession(await openSession());
    let send!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        send = controller;
      },
    });

    const response = postTenantLogs({ body, sessionToken: session.sessionToken });
    send.enqueue(new TextEncoder().encode(tenantLogLine()));
    await Bun.sleep(SETTLE_MS);
    send.error(new DOMException('The connection was closed.', 'AbortError'));

    expect((await response).status).toBe(StatusMap['No Content']);
  });

  // What the agent sends to stop the connection reading as idle. It has to survive the decoder
  // without becoming an event or an error, or the keepalive would break the stream it protects.
  test('an empty line is a keepalive, not an event and not a fault', async () => {
    const session = await readSession(await openSession());
    const response = await postTenantLogs({
      body: `\n${tenantLogLine()}\n\n`,
      sessionToken: session.sessionToken,
    });

    expect(response.status).toBe(StatusMap['No Content']);
  });

  test('a stream arriving without a session is refused', async () => {
    expect((await postTenantLogs({ body: tenantLogLine() })).status).toBe(StatusMap.Unauthorized);
  });
});

describe('nothing reaches desired state without proving what it is', () => {
  test('an unknown session is refused rather than served a default host', async () => {
    const response = await post({
      route: AGENT_ROUTES.desiredState,
      body: { knownGeneration: 0 },
      sessionToken: 'not-a-session',
    });

    expect(response.status).toBe(StatusMap.Unauthorized);
  });

  test('a missing session is refused too', async () => {
    const response = await post({
      route: AGENT_ROUTES.desiredState,
      body: { knownGeneration: 0 },
    });

    expect(response.status).toBe(StatusMap.Unauthorized);
  });

  // The two sides ship in different pipelines, so version skew is the normal state during
  // every rollout. It has to be a rejected message rather than one read as something else.
  test('an agent speaking a different protocol is turned away', async () => {
    const response = await app.handle(
      new Request(`http://control-plane${AGENT_API_PREFIX}${AGENT_ROUTES.session}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION + PROTOCOL_VERSION_SKEW),
        },
        body: JSON.stringify({ versions, capacity }),
      }),
    );

    expect(response.status).toBe(StatusMap['Bad Request']);
  });
});
