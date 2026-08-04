import { describe, expect, test } from 'bun:test';
import {
  AGENT_API_PREFIX,
  AGENT_ROUTES,
  type HostId,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  ProtocolValidationError,
  type SecretString,
} from '@repo/protocol';
import { ControlPlaneClient, ControlPlaneError } from '#control/client.ts';

const BASE_URL = 'https://control.example';
const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_UNAVAILABLE = 503;
const SOME_GENERATION = 4;
const SESSION_TOKEN = 'session-token' as SecretString;

const VALID_SESSION = {
  hostId: 'host-1',
  sessionToken: 'granted',
  expiresAt: '2026-08-03T11:00:00Z',
  poll: { maxWaitSeconds: 30, minIntervalMs: 1_000, reportIntervalMs: 15_000 },
};

const respondWith = ({ body, status = HTTP_OK }: { body: unknown; status?: number }) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = ((...args: [string, RequestInit]) => {
    calls.push({ url: args[0], init: args[1] });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
};

describe('every request identifies the protocol it speaks', () => {
  test('the version header and the session are sent', async () => {
    const { calls, fetchImpl } = respondWith({
      body: { result: 'unchanged', generation: SOME_GENERATION },
    });
    const client = new ControlPlaneClient({ baseUrl: `${BASE_URL}/`, fetchImpl });
    await client.fetchDesiredState({
      sessionToken: SESSION_TOKEN,
      request: { knownGeneration: SOME_GENERATION, waitSeconds: 1 },
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

  test('tenant logs use one streaming NDJSON request on their own route', async () => {
    const { calls, fetchImpl } = respondWith({ body: {} });
    const client = new ControlPlaneClient({ baseUrl: BASE_URL, fetchImpl });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"kind":"data"}\n'));
        controller.close();
      },
    });
    await client.streamTenantLogs({
      sessionToken: SESSION_TOKEN,
      body,
      signal: new AbortController().signal,
    });

    const call = calls[0];
    expect(call?.url).toBe(`${BASE_URL}${AGENT_API_PREFIX}${AGENT_ROUTES.tenantLogs}`);
    expect(call?.init.body).toBe(body);
    const headers = call?.init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/x-ndjson');
    expect(headers.authorization).toBe(`Bearer ${SESSION_TOKEN}`);
  });
});

test('a log chunk reaches the API while the HTTP request is still open', async () => {
  let bodyController!: ReadableStreamDefaultController<Uint8Array>;
  let releaseResponse!: () => void;
  const responseReleased = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let observeChunk!: (value: string) => void;
  const observedChunk = new Promise<string>((resolve) => {
    observeChunk = resolve;
  });
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const first = await request.body?.getReader().read();
      observeChunk(new TextDecoder().decode(first?.value));
      await responseReleased;
      return new Response(undefined, { status: HTTP_OK });
    },
  });

  try {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller;
      },
    });
    const client = new ControlPlaneClient({ baseUrl: `http://127.0.0.1:${server.port}` });
    let requestFinished = false;
    const request = client
      .streamTenantLogs({
        sessionToken: SESSION_TOKEN,
        body,
        signal: new AbortController().signal,
      })
      .finally(() => {
        requestFinished = true;
      });

    bodyController.enqueue(new TextEncoder().encode('{"text":"now"}\n'));
    expect(await observedChunk).toBe('{"text":"now"}\n');
    expect(requestFinished).toBe(false);

    bodyController.close();
    releaseResponse();
    await request;
  } finally {
    releaseResponse();
    server.stop(true);
  }
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
        request: { knownGeneration: 0, waitSeconds: 0 },
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
        request: { knownGeneration: 0, waitSeconds: 0 },
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
        request: { knownGeneration: 0, waitSeconds: 0 },
      })
      .catch((caught: unknown) => caught);
    expect((error as ControlPlaneError).isSessionExpired).toBe(false);
  });
});
