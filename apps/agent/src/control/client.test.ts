import { describe, expect, test } from 'bun:test';
import {
  AGENT_API_PREFIX,
  AGENT_ROUTES,
  type HostId,
  type HostReportedState,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  ProtocolValidationError,
  type SecretString,
} from '@repo/protocol';
import { ControlPlaneClient, ControlPlaneError } from '#control/client.ts';

const BASE_URL = 'https://control.example';
const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;
const HTTP_UNAUTHORIZED = 401;
const HTTP_UNAVAILABLE = 503;
const SOME_GENERATION = 4;
const SESSION_TOKEN = 'session-token' as SecretString;

const VALID_SESSION = {
  hostId: 'host-1',
  sessionToken: 'granted',
  expiresAt: '2026-08-03T11:00:00Z',
  poll: { minIntervalMs: 1_000, reportIntervalMs: 15_000 },
};

function respondWith({ body, status = HTTP_OK }: { body: unknown; status?: number }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = ((...args: [string, RequestInit]) => {
    calls.push({ url: args[0], init: args[1] });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('every request identifies the protocol it speaks', () => {
  test('the version header and the session are sent', async () => {
    const { calls, fetchImpl } = respondWith({
      body: { result: 'unchanged', generation: SOME_GENERATION },
    });
    const client = new ControlPlaneClient({ baseUrl: `${BASE_URL}/`, fetchImpl });
    await client.fetchDesiredState({
      sessionToken: SESSION_TOKEN,
      request: { knownGeneration: SOME_GENERATION },
    });
    const call = calls[0];
    expect(call?.url).toBe(`${BASE_URL}${AGENT_API_PREFIX}${AGENT_ROUTES.desiredState}`);
    expect(call?.init.method).toBe('POST');
    const headers = call?.init.headers as Record<string, string>;
    expect(headers[PROTOCOL_VERSION_HEADER]).toBe(String(PROTOCOL_VERSION));
    expect(headers.authorization).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  test('the session route is reached without a session', async () => {
    const { calls, fetchImpl } = respondWith({ body: VALID_SESSION });
    const client = new ControlPlaneClient({ baseUrl: BASE_URL, fetchImpl });
    const session = await client.openSession({
      versions: { agent: 'a', guestImage: 'b', zerofs: 'c', firecracker: 'd' },
      capacity: { vcpuCount: 2, memoryMib: 4096, cacheBytes: 100 },
    });
    expect(session.hostId).toBe('host-1' as HostId);
    const sessionHeaders = calls[0]?.init.headers as Record<string, string> | undefined;
    expect(sessionHeaders?.authorization).toBeUndefined();
  });

  // The report is the one route that answers with nothing, so it is the one route where reaching
  // for a body would throw on the success path rather than on a malformed one.
  test('a report expects no reply and does not read for one', async () => {
    const fetchImpl = (() =>
      Promise.resolve(new Response(null, { status: HTTP_NO_CONTENT }))) as unknown as typeof fetch;
    const client = new ControlPlaneClient({ baseUrl: BASE_URL, fetchImpl });

    expect(
      await client.sendReportedState({
        sessionToken: SESSION_TOKEN,
        report: {} as unknown as HostReportedState,
      }),
    ).toBeUndefined();
  });
});

describe('validation at the boundary', () => {
  test('a response missing a required field is rejected rather than believed', async () => {
    const { fetchImpl } = respondWith({ body: { hostId: 'host-1', sessionToken: 'granted' } });
    const client = new ControlPlaneClient({ baseUrl: BASE_URL, fetchImpl });
    await expect(
      client.openSession({
        versions: { agent: 'a', guestImage: 'b', zerofs: 'c', firecracker: 'd' },
        capacity: { vcpuCount: 2, memoryMib: 4096, cacheBytes: 100 },
      }),
    ).rejects.toThrow(ProtocolValidationError);
  });

  test('a mistyped field is rejected', async () => {
    const { fetchImpl } = respondWith({ body: { result: 'unchanged', generation: 'four' } });
    const client = new ControlPlaneClient({ baseUrl: BASE_URL, fetchImpl });
    await expect(
      client.fetchDesiredState({
        sessionToken: SESSION_TOKEN,
        request: { knownGeneration: 0 },
      }),
    ).rejects.toThrow(ProtocolValidationError);
  });

  test('unknown fields are tolerated, because a rollout always produces them', async () => {
    const { fetchImpl } = respondWith({
      body: { ...VALID_SESSION, somethingTheNewerSideAdded: { nested: true } },
    });
    const client = new ControlPlaneClient({ baseUrl: BASE_URL, fetchImpl });
    const session = await client.openSession({
      versions: { agent: 'a', guestImage: 'b', zerofs: 'c', firecracker: 'd' },
      capacity: { vcpuCount: 2, memoryMib: 4096, cacheBytes: 100 },
    });
    expect(session.expiresAt).toBe(VALID_SESSION.expiresAt as typeof session.expiresAt);
  });

  test('a timestamp with no offset is rejected: it is the silently wrong instant', async () => {
    const { fetchImpl } = respondWith({
      body: { ...VALID_SESSION, expiresAt: '2026-08-03T11:00:00' },
    });
    const client = new ControlPlaneClient({ baseUrl: BASE_URL, fetchImpl });
    await expect(
      client.openSession({
        versions: { agent: 'a', guestImage: 'b', zerofs: 'c', firecracker: 'd' },
        capacity: { vcpuCount: 2, memoryMib: 4096, cacheBytes: 100 },
      }),
    ).rejects.toThrow(ProtocolValidationError);
  });
});

describe('errors', () => {
  test('a 401 is recognisable as an expired session', async () => {
    const { fetchImpl } = respondWith({ body: { error: 'expired' }, status: HTTP_UNAUTHORIZED });
    const client = new ControlPlaneClient({ baseUrl: BASE_URL, fetchImpl });
    const error = await client
      .fetchDesiredState({
        sessionToken: SESSION_TOKEN,
        request: { knownGeneration: 0 },
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ControlPlaneError);
    expect((error as ControlPlaneError).isSessionExpired).toBe(true);
  });

  test('another failure status is not mistaken for one', async () => {
    const { fetchImpl } = respondWith({ body: { error: 'boom' }, status: HTTP_UNAVAILABLE });
    const client = new ControlPlaneClient({ baseUrl: BASE_URL, fetchImpl });
    const error = await client
      .fetchDesiredState({
        sessionToken: SESSION_TOKEN,
        request: { knownGeneration: 0 },
      })
      .catch((caught: unknown) => caught);
    expect((error as ControlPlaneError).isSessionExpired).toBe(false);
  });
});
