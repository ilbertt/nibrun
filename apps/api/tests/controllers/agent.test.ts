import { describe, expect, test } from 'bun:test';
import {
  AGENT_API_PREFIX,
  AGENT_ROUTES,
  type AgentSessionRequest,
  AgentSessionSchema,
  type AppId,
  DesiredStateResponseSchema,
  FilesystemQueryResponseSchema,
  type HostCapacity,
  type HostReportedState,
  type HostVersions,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  parseMessage,
} from '@repo/protocol';
import { StatusMap } from 'elysia';
import { ORIGIN, sendJson } from '#tests/controllers/support/api.ts';

// What an agent that has never polled reports knowing, so this is the case that
// has to yield state rather than `unchanged`.
const FIRST_POLL_GENERATION = 0;

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

async function readDesired(response: Response) {
  return parseMessage({ schema: DesiredStateResponseSchema, value: await response.json() });
}

async function readFilesystemQuery(response: Response) {
  return parseMessage({ schema: FilesystemQueryResponseSchema, value: await response.json() });
}

type SessionToken = Awaited<ReturnType<typeof readSession>>['sessionToken'];

function openSession(overrides: Partial<AgentSessionRequest> = {}) {
  return post({
    route: AGENT_ROUTES.session,
    body: { versions, capacity, ...overrides },
  });
}

async function startSession() {
  return readSession(await openSession());
}

async function pollDesired({
  sessionToken,
  knownGeneration,
}: {
  sessionToken?: string;
  knownGeneration: number;
}) {
  return readDesired(
    await post({ route: AGENT_ROUTES.desiredState, body: { knownGeneration }, sessionToken }),
  );
}

async function firstDesiredState(sessionToken: SessionToken) {
  const response = await pollDesired({ sessionToken, knownGeneration: FIRST_POLL_GENERATION });
  if (response.result !== 'changed') {
    throw new Error('A host that has never polled must be given state to converge to.');
  }
  return response.state;
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

  test('a host that has never polled is told its state, not that nothing changed', async () => {
    const session = await startSession();

    // Desired state carries no host id, so a host can only ever be told about itself.
    expect((await firstDesiredState(session.sessionToken)).hostId).toBe(session.hostId);
  });

  test('and told nothing when it is already current', async () => {
    const session = await startSession();
    const first = await firstDesiredState(session.sessionToken);

    const second = await pollDesired({
      sessionToken: session.sessionToken,
      knownGeneration: first.generation,
    });

    expect(second).toEqual({ result: 'unchanged', generation: first.generation });
  });

  test('a report is accepted without being answered', async () => {
    const session = await startSession();
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

describe('a host polls for filesystem reads on a channel of its own', () => {
  test('a host with nothing to answer is told so, and told no generation', async () => {
    const session = await startSession();

    const body = await readFilesystemQuery(
      await pollFilesystem({ sessionToken: session.sessionToken }),
    );

    expect(body).toEqual({ result: 'none' });
  });

  // A read that could bump a generation would make one person opening a folder cost every host
  // in the fleet a re-read. The two channels stay disjoint, and this is what says so.
  test('polling for a read leaves desired state where it was', async () => {
    const session = await startSession();
    const before = await firstDesiredState(session.sessionToken);

    await pollFilesystem({ sessionToken: session.sessionToken });

    const after = await pollDesired({
      sessionToken: session.sessionToken,
      knownGeneration: before.generation,
    });
    expect(after).toEqual({ result: 'unchanged', generation: before.generation });
  });

  test('a host serving the app is given something to read', async () => {
    const session = await startSession();
    const desired = await firstDesiredState(session.sessionToken);

    const body = await readFilesystemQuery(
      await pollFilesystem({
        sessionToken: session.sessionToken,
        servedAppIds: desired.volumes.map((volume) => volume.appId),
      }),
    );

    expect(body.result).toBe('query');
  });

  // Nothing comes back, for the same reason nothing comes back from a report: a generation
  // travels on one channel only, and a second copy here would be a second thing to keep true.
  test('an answer is taken and not replied to', async () => {
    const session = await startSession();

    const response = await answerFilesystem({
      sessionToken: session.sessionToken,
      queryId: 'query-pocketbase-root',
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
      body: { knownGeneration: FIRST_POLL_GENERATION },
      sessionToken: 'not-a-session',
    });

    expect(response.status).toBe(StatusMap.Unauthorized);
  });

  test('a missing session is refused too', async () => {
    const response = await post({
      route: AGENT_ROUTES.desiredState,
      body: { knownGeneration: FIRST_POLL_GENERATION },
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
