import { describe, expect, test } from 'bun:test';
import {
  AGENT_API_PREFIX,
  AGENT_ROUTES,
  AgentSessionSchema,
  CronQueryResponseSchema,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  parseMessage,
} from '@repo/protocol';
import { StatusMap } from 'elysia';
import { ORIGIN, send, sendJson } from '#tests/controllers/support/api.ts';
import { CRON_DEPLOYMENT, CRON_LISTING } from '#tests/support/crons.ts';

function post({
  route,
  body,
  sessionToken,
  protocolVersion = PROTOCOL_VERSION,
  signal,
}: {
  route: string;
  body: unknown;
  sessionToken?: string;
  protocolVersion?: number;
  signal?: AbortSignal;
}) {
  return sendJson({
    method: 'POST',
    url: `${ORIGIN}${AGENT_API_PREFIX}${route}`,
    headers: {
      [PROTOCOL_VERSION_HEADER]: String(protocolVersion),
      ...(sessionToken && { authorization: `Bearer ${sessionToken}` }),
    },
    body,
    signal,
  });
}

async function session() {
  const response = await post({
    route: AGENT_ROUTES.session,
    body: {
      versions: { agent: 'a', guestImage: 'b', zerofs: 'c', firecracker: 'd' },
      capacity: { vcpuCount: 2, memoryMib: 4096, cacheBytes: 100 },
    },
  });
  return parseMessage({ schema: AgentSessionSchema, value: await response.json() });
}

describe('cron listing routes', () => {
  test('the public listing route requires authentication', async () => {
    const response = await send({
      url: `${ORIGIN}/api/apps/${CRON_DEPLOYMENT.appId}/deployments/${CRON_DEPLOYMENT.deploymentId}/crons`,
    });
    expect(response.status).toBe(StatusMap.Unauthorized);
  });

  test.each([undefined, 'not-a-session'])('a poll rejects session %s', async (sessionToken) => {
    const response = await post({
      route: AGENT_ROUTES.cronQuery,
      body: { servedDeployments: [CRON_DEPLOYMENT] },
      sessionToken,
    });
    expect(response.status).toBe(StatusMap.Unauthorized);
  });

  test('an unknown session cannot answer a query', async () => {
    const response = await post({
      route: AGENT_ROUTES.cronQueryResult,
      sessionToken: 'not-a-session',
      body: { queryId: 'q-1', outcome: { status: 'listed', listing: CRON_LISTING } },
    });
    expect(response.status).toBe(StatusMap.Unauthorized);
  });

  test('a poll rejects protocol version skew', async () => {
    const response = await post({
      route: AGENT_ROUTES.cronQuery,
      protocolVersion: PROTOCOL_VERSION + 1,
      body: { servedDeployments: [] },
    });
    expect(response.status).toBe(StatusMap['Bad Request']);
  });

  test('deployment identity is required before a query is collected', async () => {
    const response = await post({
      route: AGENT_ROUTES.cronQuery,
      body: { servedDeployments: [{ appId: CRON_DEPLOYMENT.appId }] },
    });
    expect(response.status).toBe(StatusMap['Bad Request']);
  });

  test('a valid host poll ends with none when its request is abandoned', async () => {
    const { sessionToken } = await session();
    const response = await post({
      route: AGENT_ROUTES.cronQuery,
      body: { servedDeployments: [CRON_DEPLOYMENT] },
      sessionToken,
      signal: AbortSignal.abort(),
    });
    expect(response.status).toBe(StatusMap.OK);
    expect(parseMessage({ schema: CronQueryResponseSchema, value: await response.json() })).toEqual(
      { result: 'none' },
    );
  });

  test('a late result from a valid host receives an empty acknowledgement', async () => {
    const { sessionToken } = await session();
    const response = await post({
      route: AGENT_ROUTES.cronQueryResult,
      sessionToken,
      body: { queryId: 'q-1', outcome: { status: 'listed', listing: CRON_LISTING } },
    });
    expect(response.status).toBe(StatusMap['No Content']);
    expect(await response.text()).toBe('');
  });
});
