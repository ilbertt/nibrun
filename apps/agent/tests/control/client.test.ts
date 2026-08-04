import { describe, expect, test } from 'bun:test';
import {
  AGENT_API_PREFIX,
  AGENT_ROUTES,
  type HostId,
  type HostReportedState,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  type SecretString,
} from '@repo/protocol';
import { Effect, Exit, Fiber, Option } from 'effect';
import { ControlPlaneError, makeControlPlaneClient } from '#control/client.ts';
import { runScoped } from '#tests/support/run.ts';
import {
  HTTP_NO_CONTENT,
  HTTP_OK,
  HTTP_UNAUTHORIZED,
  HTTP_UNAVAILABLE,
  recordingServer,
  serving,
} from '#tests/support/server.ts';

const SOME_GENERATION = 4;
const SESSION_TOKEN = 'session-token' as SecretString;
const NO_REPLY = { body: undefined, status: HTTP_NO_CONTENT };

const VALID_SESSION = {
  hostId: 'host-1',
  sessionToken: 'granted',
  expiresAt: '2026-08-03T11:00:00Z',
  poll: { minIntervalMs: 1_000, reportIntervalMs: 15_000 },
};

const SESSION_REQUEST = {
  versions: { agent: 'a', guestImage: 'b', zerofs: 'c', firecracker: 'd' },
  capacity: { vcpuCount: 2, memoryMib: 4096, cacheBytes: 100 },
} as Parameters<ReturnType<typeof makeControlPlaneClient>['openSession']>[0];

type Reply = { body?: unknown; status?: number };

function controlPlane(reply: Reply) {
  return Effect.map(recordingServer(reply), ({ received, baseUrl }) => ({
    received,
    baseUrl,
    client: makeControlPlaneClient({ baseUrl }),
  }));
}

function desiredState(client: ReturnType<typeof makeControlPlaneClient>) {
  return client.fetchDesiredState({
    sessionToken: SESSION_TOKEN,
    request: { knownGeneration: SOME_GENERATION },
  });
}

function desiredStateFailure(reply: Reply) {
  return runScoped(
    Effect.flatMap(controlPlane(reply), ({ client }) => Effect.flip(desiredState(client))),
  );
}

function sessionFailure(reply: Reply) {
  return runScoped(
    Effect.flatMap(controlPlane(reply), ({ client }) =>
      Effect.flip(client.openSession(SESSION_REQUEST)),
    ),
  );
}

describe('every request identifies the protocol it speaks', () => {
  test('the version header and the session are sent', async () => {
    const { call, baseUrl } = await runScoped(
      Effect.gen(function* () {
        const { received, baseUrl } = yield* controlPlane({
          body: { result: 'unchanged', generation: SOME_GENERATION },
        });
        // A trailing slash is stripped, or every route would be reached one slash too deep.
        yield* desiredState(makeControlPlaneClient({ baseUrl: `${baseUrl}/` }));
        return { call: received[0], baseUrl };
      }),
    );

    expect(call?.url).toBe(`${baseUrl}${AGENT_API_PREFIX}${AGENT_ROUTES.desiredState}`);
    expect(call?.method).toBe('POST');
    expect(call?.headers[PROTOCOL_VERSION_HEADER]).toBe(String(PROTOCOL_VERSION));
    expect(call?.headers.authorization).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  test('the session route is reached without a session', async () => {
    const { session, call } = await runScoped(
      Effect.gen(function* () {
        const { client, received } = yield* controlPlane({ body: VALID_SESSION });
        return { session: yield* client.openSession(SESSION_REQUEST), call: received[0] };
      }),
    );

    expect(session.hostId).toBe('host-1' as HostId);
    expect(call?.headers.authorization).toBeUndefined();
  });

  // The report is the one route that answers with nothing, so it is the one route where reaching
  // for a body would fail on the success path rather than on a malformed one.
  test('a report expects no reply and does not read for one', async () => {
    expect(
      await runScoped(
        Effect.flatMap(controlPlane(NO_REPLY), ({ client }) =>
          client.sendReportedState({
            sessionToken: SESSION_TOKEN,
            report: {} as unknown as HostReportedState,
          }),
        ),
      ),
    ).toBeUndefined();
  });

  test('tenant logs use one streaming NDJSON request on their own route', async () => {
    const { call, baseUrl } = await runScoped(
      Effect.gen(function* () {
        const { client, received, baseUrl } = yield* controlPlane(NO_REPLY);
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"kind":"data"}\n'));
            controller.close();
          },
        });
        yield* client.streamTenantLogs({ sessionToken: SESSION_TOKEN, body });
        return { call: received[0], baseUrl };
      }),
    );

    expect(call?.url).toBe(`${baseUrl}${AGENT_API_PREFIX}${AGENT_ROUTES.tenantLogs}`);
    // The stream reached the wire as itself. Handed to the client as a call argument instead, it
    // would arrive as the `{}` that `JSON.stringify` makes of a ReadableStream.
    expect(call?.body).toBe('{"kind":"data"}\n');
    expect(call?.headers['content-type']).toBe('application/x-ndjson');
    expect(call?.headers.authorization).toBe(`Bearer ${SESSION_TOKEN}`);
  });
});

test('a log chunk reaches the API while the HTTP request is still open', async () => {
  let releaseResponse!: () => void;
  const responseReleased = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let observeChunk!: (value: string) => void;
  const observedChunk = new Promise<string>((resolve) => {
    observeChunk = resolve;
  });
  let bodyController!: ReadableStreamDefaultController<Uint8Array>;

  const { chunk, stillOpen } = await runScoped(
    Effect.gen(function* () {
      const server = yield* serving(async (request) => {
        const first = await request.body?.getReader().read();
        observeChunk(new TextDecoder().decode(first?.value));
        await responseReleased;
        return new Response(undefined, { status: HTTP_OK });
      });
      const client = makeControlPlaneClient({ baseUrl: server.baseUrl });
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          bodyController = controller;
        },
      });

      const upload = yield* Effect.fork(
        client.streamTenantLogs({ sessionToken: SESSION_TOKEN, body }),
      );
      yield* Effect.sync(() =>
        bodyController.enqueue(new TextEncoder().encode('{"text":"now"}\n')),
      );
      const chunk = yield* Effect.promise(() => observedChunk);
      // The server is still holding its response, so an upload that had finished finished early.
      const stillOpen = Option.isNone(yield* Fiber.poll(upload));

      yield* Effect.sync(() => bodyController.close());
      yield* Effect.sync(releaseResponse);
      yield* Fiber.join(upload);
      return { chunk, stillOpen };
    }).pipe(Effect.ensuring(Effect.sync(() => releaseResponse()))),
  );

  expect(chunk).toBe('{"text":"now"}\n');
  expect(stillOpen).toBe(true);
});

// Interrupting the effect is what ends an upload the agent no longer wants — the one case where
// nothing else is coming to end the request.
test('interrupting the upload ends it', async () => {
  const exit = await runScoped(
    Effect.gen(function* () {
      const server = yield* serving(() => new Promise<Response>(() => {}));
      return yield* Effect.exit(
        makeControlPlaneClient({ baseUrl: server.baseUrl })
          .streamTenantLogs({
            sessionToken: SESSION_TOKEN,
            body: new ReadableStream<Uint8Array>({ start: () => {} }),
          })
          .pipe(Effect.timeout('100 millis')),
      );
    }),
  );

  expect(Exit.isFailure(exit)).toBe(true);
});

describe('validation at the boundary', () => {
  test('a response missing a required field is rejected rather than believed', async () => {
    const error = await sessionFailure({ body: { hostId: 'host-1', sessionToken: 'granted' } });
    expect(String(error)).toContain('does not match the protocol');
  });

  test('a mistyped field is rejected', async () => {
    const error = await desiredStateFailure({ body: { result: 'unchanged', generation: 'four' } });
    expect(String(error)).toContain('does not match the protocol');
  });

  test('unknown fields are tolerated, because a rollout always produces them', async () => {
    const session = await runScoped(
      Effect.flatMap(
        controlPlane({ body: { ...VALID_SESSION, somethingTheNewerSideAdded: { nested: true } } }),
        ({ client }) => client.openSession(SESSION_REQUEST),
      ),
    );

    expect(session.expiresAt).toBe(VALID_SESSION.expiresAt as typeof session.expiresAt);
  });

  test('a timestamp with no offset is rejected: it is the silently wrong instant', async () => {
    const error = await sessionFailure({
      body: { ...VALID_SESSION, expiresAt: '2026-08-03T11:00:00' },
    });
    expect(String(error)).toContain('does not match the protocol');
  });
});

describe('errors', () => {
  test('a 401 is recognisable as an expired session', async () => {
    const error = await desiredStateFailure({
      body: { error: 'expired' },
      status: HTTP_UNAUTHORIZED,
    });

    expect(error).toBeInstanceOf(ControlPlaneError);
    expect((error as ControlPlaneError).isSessionExpired).toBe(true);
  });

  test('another failure status is not mistaken for one', async () => {
    expect(
      (await desiredStateFailure({
        body: { error: 'boom' },
        status: HTTP_UNAVAILABLE,
      })) as ControlPlaneError,
    ).toMatchObject({ status: HTTP_UNAVAILABLE });
  });
});
