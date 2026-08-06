import { describe, expect, test } from 'bun:test';
import {
  AGENT_API_PREFIX,
  AGENT_ROUTES,
  type AgentSessionRequest,
  AgentSessionSchema,
  type AppId,
  AppIdSchema,
  FilesystemQueryResponseSchema,
  type HostCapacity,
  type HostVersions,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  parseMessage,
  Value,
} from '@repo/protocol';
import { StatusMap } from 'elysia';
import { ORIGIN, sendJson } from '#tests/controllers/support/api.ts';

const A_SERVED_APP_ID = Value.Parse(AppIdSchema, 'app-pocketbase');

const PROTOCOL_VERSION_SKEW = 1;

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
  protocolVersion = PROTOCOL_VERSION,
}: {
  route: string;
  body: unknown;
  sessionToken?: string;
  protocolVersion?: number;
}) {
  return sendJson({
    method: 'POST',
    url: `${ORIGIN}${AGENT_API_PREFIX}${route}`,
    headers: {
      [PROTOCOL_VERSION_HEADER]: String(protocolVersion),
      ...(sessionToken && { authorization: `Bearer ${sessionToken}` }),
    },
    body,
  });
}

// Every response is read back through the protocol's own schema, so the test
// fails if the api answers something the agent could not have parsed — the same
// check the agent performs, run from the other side.
async function readSession(response: Response) {
  return parseMessage({ schema: AgentSessionSchema, value: await response.json() });
}

async function readFilesystemQuery(response: Response) {
  return parseMessage({ schema: FilesystemQueryResponseSchema, value: await response.json() });
}

function openSession(overrides: Partial<AgentSessionRequest> = {}) {
  return post({
    route: AGENT_ROUTES.session,
    body: { versions, capacity, ...overrides },
  });
}

async function startSession() {
  return readSession(await openSession());
}

function pollFilesystem({
  sessionToken,
  servedAppIds = [],
}: {
  sessionToken?: string;
  servedAppIds?: readonly AppId[];
}) {
  return post({ route: AGENT_ROUTES.filesystemQuery, body: { servedAppIds }, sessionToken });
}

function answerFilesystem({ sessionToken, queryId }: { sessionToken?: string; queryId: string }) {
  return post({
    route: AGENT_ROUTES.filesystemQueryResult,
    body: { queryId, outcome: { status: 'failed', message: 'no device is attached on this host' } },
    sessionToken,
  });
}

describe('an agent can register and be told what to run', () => {
  test('a session names the host and how often to come back', async () => {
    const session = await startSession();

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
});

describe('a host polls for filesystem reads on a channel of its own', () => {
  test('a host with nothing to answer is told so, and told no generation', async () => {
    const session = await startSession();

    const body = await readFilesystemQuery(
      await pollFilesystem({ sessionToken: session.sessionToken }),
    );

    expect(body).toEqual({ result: 'none' });
  });

  // A read exists only while somebody is waiting on it, so serving an app is not by itself a
  // reason to be sent to a device. Nothing standing means an idle fleet reads no tenant disks.
  test('a host serving an app nobody is browsing is still told nothing', async () => {
    const session = await startSession();

    const body = await readFilesystemQuery(
      await pollFilesystem({
        sessionToken: session.sessionToken,
        servedAppIds: [A_SERVED_APP_ID],
      }),
    );

    expect(body).toEqual({ result: 'none' });
  });

  // Nothing comes back, for the same reason nothing comes back from a report: a generation
  // travels on one channel only, and a second copy here would be a second thing to keep true.
  // A host whose caller has already given up is taken at its word too, rather than errored at.
  test('an answer is taken and not replied to', async () => {
    const session = await startSession();

    const response = await answerFilesystem({
      sessionToken: session.sessionToken,
      queryId: 'query-nobody-is-waiting-for',
    });

    expect(response.status).toBe(StatusMap['No Content']);
    expect(await response.text()).toBe('');
  });
});

describe('nothing reaches desired state without proving what it is', () => {
  test('an unknown session cannot collect another tenant read', async () => {
    const response = await pollFilesystem({ sessionToken: 'not-a-session' });

    expect(response.status).toBe(StatusMap.Unauthorized);
  });

  test('nor answer one', async () => {
    const response = await answerFilesystem({
      sessionToken: 'not-a-session',
      queryId: 'query-1',
    });

    expect(response.status).toBe(StatusMap.Unauthorized);
  });

  test('an unknown session is refused rather than served a default host', async () => {
    const response = await post({
      route: AGENT_ROUTES.desiredState,
      body: {},
      sessionToken: 'not-a-session',
    });

    expect(response.status).toBe(StatusMap.Unauthorized);
  });

  test('a missing session is refused too', async () => {
    const response = await post({
      route: AGENT_ROUTES.desiredState,
      body: {},
    });

    expect(response.status).toBe(StatusMap.Unauthorized);
  });

  // The two sides ship in different pipelines, so version skew is the normal state during
  // every rollout. It has to be a rejected message rather than one read as something else.
  test('an agent speaking a different protocol is turned away', async () => {
    const response = await post({
      route: AGENT_ROUTES.session,
      body: { versions, capacity },
      protocolVersion: PROTOCOL_VERSION + PROTOCOL_VERSION_SKEW,
    });

    expect(response.status).toBe(StatusMap['Bad Request']);
  });
});
