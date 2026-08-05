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
} from '@repo/protocol';
import { StatusMap } from 'elysia';

// What an agent that has never polled reports knowing, so this is the case that
// has to yield state rather than `unchanged`.
const FIRST_POLL_GENERATION = 0;

const BETTER_AUTH_SECRET_LENGTH = 32;
const PROTOCOL_VERSION_SKEW = 1;

// The api reads its configuration when the service graph is constructed, so the
// environment has to exist before the app module is imported.
const REQUIRED_ENV = {
  DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none',
  BETTER_AUTH_SECRET: 'x'.repeat(BETTER_AUTH_SECRET_LENGTH),
  GITHUB_CLIENT_ID: 'test',
  GITHUB_CLIENT_SECRET: 'test',
  S3_ENDPOINT: 'http://127.0.0.1:1',
  VICTORIALOGS_ENDPOINT: 'http://127.0.0.1:1',
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
