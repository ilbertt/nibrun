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
import { Effect } from 'effect';
import { ControlPlaneError, makeControlPlaneClient } from '#lib/control/client.ts';
import { runScoped } from '#tests/support/run.ts';
import {
  HTTP_NO_CONTENT,
  HTTP_UNAUTHORIZED,
  HTTP_UNAVAILABLE,
  recordingServer,
} from '#tests/support/server.ts';

const SESSION_TOKEN = 'session-token' as SecretString;

const VALID_DESIRED_STATE = {
  hostId: 'host-1',
  volumes: [],
  instances: [],
  checkpoints: [],
  exports: [],
};
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
    request: {},
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
          body: VALID_DESIRED_STATE,
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
});

// The read channel is separate from desired state all the way down to the wire, and these are
// what say so: a different route, and a reply that is not a state anything converges on.
describe('a filesystem read travels on its own routes', () => {
  test('a poll for a read reaches the query route', async () => {
    const { call, baseUrl } = await runScoped(
      Effect.gen(function* () {
        const { client, received, baseUrl } = yield* controlPlane({ body: { result: 'none' } });
        yield* client.fetchFilesystemQuery({
          sessionToken: SESSION_TOKEN,
          request: { servedAppIds: [] },
        });
        return { call: received[0], baseUrl };
      }),
    );

    expect(call?.url).toBe(`${baseUrl}${AGENT_API_PREFIX}${AGENT_ROUTES.filesystemQuery}`);
    expect(call?.headers.authorization).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  test('an answer is posted to the result route and expects no reply', async () => {
    const { result, call, baseUrl } = await runScoped(
      Effect.gen(function* () {
        const { client, received, baseUrl } = yield* controlPlane(NO_REPLY);
        const result = yield* client.sendFilesystemQueryResult({
          sessionToken: SESSION_TOKEN,
          result: {
            queryId: 'query-1' as never,
            outcome: { status: 'failed', message: 'no device is attached on this host' },
          },
        });
        return { result, call: received[0], baseUrl };
      }),
    );

    expect(result).toBeUndefined();
    expect(call?.url).toBe(`${baseUrl}${AGENT_API_PREFIX}${AGENT_ROUTES.filesystemQueryResult}`);
  });

  test('a malformed query is rejected rather than read as a directory', async () => {
    const error = await runScoped(
      Effect.flatMap(controlPlane({ body: { result: 'query' } }), ({ client }) =>
        Effect.flip(
          client.fetchFilesystemQuery({
            sessionToken: SESSION_TOKEN,
            request: { servedAppIds: [] },
          }),
        ),
      ),
    );

    expect(String(error)).toContain('does not match the protocol');
  });
});

describe('validation at the boundary', () => {
  test('a response missing a required field is rejected rather than believed', async () => {
    const error = await sessionFailure({ body: { hostId: 'host-1', sessionToken: 'granted' } });
    expect(String(error)).toContain('does not match the protocol');
  });

  test('a mistyped field is rejected', async () => {
    const error = await desiredStateFailure({
      body: { ...VALID_DESIRED_STATE, instances: 'not a list' },
    });
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
