import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
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

type ReceivedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
};

// A real listener rather than a substituted `fetch`: what the client hands the network is the
// thing under test here, and the only way to read it without trusting the client's own plumbing
// is to receive it.
let received: ReceivedRequest[] = [];
let reply: { body?: unknown; status: number } = { body: {}, status: HTTP_OK };

const controlPlane = Bun.serve({
  port: 0,
  async fetch(request) {
    received.push({
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body: await request.text(),
    });
    return reply.body === undefined
      ? new Response(null, { status: reply.status })
      : Response.json(reply.body, { status: reply.status });
  },
});

const BASE_URL = `http://127.0.0.1:${controlPlane.port}`;

beforeEach(() => {
  received = [];
  reply = { body: {}, status: HTTP_OK };
});

afterAll(() => {
  controlPlane.stop(true);
});

function respondWith({ body, status = HTTP_OK }: { body?: unknown; status?: number }) {
  reply = { body, status };
}

describe('every request identifies the protocol it speaks', () => {
  test('the version header and the session are sent', async () => {
    respondWith({ body: { result: 'unchanged', generation: SOME_GENERATION } });
    const client = new ControlPlaneClient({ baseUrl: `${BASE_URL}/` });
    await client.fetchDesiredState({
      sessionToken: SESSION_TOKEN,
      request: { knownGeneration: SOME_GENERATION },
    });
    const call = received[0];
    expect(call?.url).toBe(`${BASE_URL}${AGENT_API_PREFIX}${AGENT_ROUTES.desiredState}`);
    expect(call?.method).toBe('POST');
    expect(call?.headers[PROTOCOL_VERSION_HEADER]).toBe(String(PROTOCOL_VERSION));
    expect(call?.headers.authorization).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  test('the session route is reached without a session', async () => {
    respondWith({ body: VALID_SESSION });
    const client = new ControlPlaneClient({ baseUrl: BASE_URL });
    const session = await client.openSession({
      versions: { agent: 'a', guestImage: 'b', zerofs: 'c', firecracker: 'd' },
      capacity: { vcpuCount: 2, memoryMib: 4096, cacheBytes: 100 },
    });
    expect(session.hostId).toBe('host-1' as HostId);
    expect(received[0]?.headers.authorization).toBeUndefined();
  });

  // The report is the one route that answers with nothing, so it is the one route where reaching
  // for a body would throw on the success path rather than on a malformed one.
  test('a report expects no reply and does not read for one', async () => {
    respondWith({ body: undefined, status: HTTP_NO_CONTENT });
    const client = new ControlPlaneClient({ baseUrl: BASE_URL });

    expect(
      await client.sendReportedState({
        sessionToken: SESSION_TOKEN,
        report: {} as unknown as HostReportedState,
      }),
    ).toBeUndefined();
  });

  test('tenant logs use one streaming NDJSON request on their own route', async () => {
    respondWith({ body: undefined, status: HTTP_NO_CONTENT });
    const client = new ControlPlaneClient({ baseUrl: BASE_URL });
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

    const call = received[0];
    expect(call?.url).toBe(`${BASE_URL}${AGENT_API_PREFIX}${AGENT_ROUTES.tenantLogs}`);
    // The stream reached the wire as itself. Handed to the client as a call argument instead,
    // it would arrive as the `{}` that `JSON.stringify` makes of a ReadableStream.
    expect(call?.body).toBe('{"kind":"data"}\n');
    expect(call?.headers['content-type']).toBe('application/x-ndjson');
    expect(call?.headers.authorization).toBe(`Bearer ${SESSION_TOKEN}`);
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

// The deadline that guards a control plane which never answers is composed with this signal
// rather than replacing it, and a composition that swallowed the caller's would strand the
// agent on shutdown — the one case where nothing else is coming to end the request.
test('a caller that cancels still ends the upload', async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) });
  const abort = new AbortController();
  const client = new ControlPlaneClient({ baseUrl: `http://127.0.0.1:${server.port}` });

  try {
    const request = client
      .streamTenantLogs({
        sessionToken: SESSION_TOKEN,
        body: new ReadableStream<Uint8Array>({ start: () => {} }),
        signal: abort.signal,
      })
      .catch((caught: unknown) => caught);

    abort.abort();
    expect(await request).toBeInstanceOf(ControlPlaneError);
  } finally {
    server.stop(true);
  }
});

describe('validation at the boundary', () => {
  test('a response missing a required field is rejected rather than believed', async () => {
    respondWith({ body: { hostId: 'host-1', sessionToken: 'granted' } });
    const client = new ControlPlaneClient({ baseUrl: BASE_URL });
    await expect(
      client.openSession({
        versions: { agent: 'a', guestImage: 'b', zerofs: 'c', firecracker: 'd' },
        capacity: { vcpuCount: 2, memoryMib: 4096, cacheBytes: 100 },
      }),
    ).rejects.toThrow(ProtocolValidationError);
  });

  test('a mistyped field is rejected', async () => {
    respondWith({ body: { result: 'unchanged', generation: 'four' } });
    const client = new ControlPlaneClient({ baseUrl: BASE_URL });
    await expect(
      client.fetchDesiredState({
        sessionToken: SESSION_TOKEN,
        request: { knownGeneration: 0 },
      }),
    ).rejects.toThrow(ProtocolValidationError);
  });

  test('unknown fields are tolerated, because a rollout always produces them', async () => {
    respondWith({ body: { ...VALID_SESSION, somethingTheNewerSideAdded: { nested: true } } });
    const client = new ControlPlaneClient({ baseUrl: BASE_URL });
    const session = await client.openSession({
      versions: { agent: 'a', guestImage: 'b', zerofs: 'c', firecracker: 'd' },
      capacity: { vcpuCount: 2, memoryMib: 4096, cacheBytes: 100 },
    });
    expect(session.expiresAt).toBe(VALID_SESSION.expiresAt as typeof session.expiresAt);
  });

  test('a timestamp with no offset is rejected: it is the silently wrong instant', async () => {
    respondWith({ body: { ...VALID_SESSION, expiresAt: '2026-08-03T11:00:00' } });
    const client = new ControlPlaneClient({ baseUrl: BASE_URL });
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
    respondWith({ body: { error: 'expired' }, status: HTTP_UNAUTHORIZED });
    const client = new ControlPlaneClient({ baseUrl: BASE_URL });
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
    respondWith({ body: { error: 'boom' }, status: HTTP_UNAVAILABLE });
    const client = new ControlPlaneClient({ baseUrl: BASE_URL });
    const error = await client
      .fetchDesiredState({
        sessionToken: SESSION_TOKEN,
        request: { knownGeneration: 0 },
      })
      .catch((caught: unknown) => caught);
    expect((error as ControlPlaneError).isSessionExpired).toBe(false);
  });
});
