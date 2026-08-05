import { describe, expect, test } from 'bun:test';
import {
  AGENT_API_PREFIX,
  AGENT_ROUTES,
  type AppId,
  type HostCapacity,
  type HostVersions,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
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

// What each route does with a session it accepts is a service test: every one of them reads
// the database, and the api under test here is pointed at a closed port. What is left is the
// part a service test cannot see — that the routes are mounted and that none of them serves a
// caller who has not proved which host it is.
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
