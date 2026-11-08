import { expect, test } from 'bun:test';
import { createServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { type DesiredInstance, GuestPathSchema } from '@repo/protocol';
import type { HranaPipelineReqBody } from '@repo/sqlite';
import { Value } from '@sinclair/typebox/value';
import { Effect, Ref } from 'effect';
import { connectNibrunnerGuest } from '#lib/nibrunner/guest-connection.ts';
import { makeNibrunnerSqliteGuest } from '#lib/nibrunner/sqlite-guest.ts';
import { GUEST_SQLITE_VSOCK_PORT } from '#lib/sqlite/client.ts';
import { NibrunnerGuestConnections } from '#services/nibrunner-guest-connections.service.ts';
import { APP_ID, DEPLOYMENT_ID, desiredInstance } from '#tests/support/fixtures.ts';
import { sqlitePipelineResponse } from '#tests/support/guest-sqlite.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';
import { sqliteQuery } from '#tests/support/sqlite-sessions.ts';

const run = provided(platform);
const QUERY = sqliteQuery({ type: 'close' });
const PIPELINE: HranaPipelineReqBody = {
  baton: null,
  requests: [
    {
      type: 'execute',
      stmt: { sql: 'SELECT value', args: [], named_args: [], want_rows: true },
    },
  ],
};

const fixture = Effect.gen(function* () {
  const socketPath = `${yield* temporaryDirectory}/guest.sock`;
  const deployments = yield* Ref.make<readonly DesiredInstance[]>([desiredInstance()]);
  const connections: Array<{ target: string | undefined; match: string | undefined }> = [];
  const requests: string[] = [];
  const sockets = new Set<Duplex>();
  const reply = sqlitePipelineResponse();
  const body = reply.subarray(reply.indexOf('\r\n\r\n') + Buffer.byteLength('\r\n\r\n'));
  // biome-ignore lint/complexity/useMaxParams: Node supplies the HTTP request and response.
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    request.resume();
    request.once('end', () => {
      response.setHeader('content-type', 'application/json');
      response.end(request.method === 'GET' ? '{}' : body);
    });
  });
  const world = { onConnect: () => Effect.void };
  // biome-ignore lint/complexity/useMaxParams: Node supplies the CONNECT request and stream.
  server.on('connect', (request, socket) => {
    connections.push({ target: request.url, match: request.headers['if-match'] });
    sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.on('close', () => sockets.delete(socket));
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    server.emit('connection', socket);
  });
  yield* Effect.acquireRelease(
    Effect.async<void>((resume) => {
      server.once('error', (error) => resume(Effect.die(error)));
      server.listen(socketPath, () => resume(Effect.void));
    }),
    () =>
      Effect.sync(() => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close();
      }),
  );
  const guest = yield* makeNibrunnerSqliteGuest({ deployments: Ref.get(deployments) }).pipe(
    Effect.provideService(
      NibrunnerGuestConnections,
      NibrunnerGuestConnections.make({
        connect: (input) =>
          connectNibrunnerGuest({ ...input, socketPath }).pipe(Effect.tap(() => world.onConnect())),
      }),
    ),
  );
  return { guest, deployments, connections, requests, world };
});

test('SQLite uses one deployment-fenced tunnel and preserves integer values', async () => {
  await run(
    Effect.gen(function* () {
      const { guest, connections, requests } = yield* fixture;
      const client = yield* guest.connect(QUERY);
      yield* client.open(Value.Parse(GuestPathSchema, '/app.db'));
      const result = yield* client.pipeline(PIPELINE);
      expect(JSON.stringify(result)).toContain('9223372036854775807');
      expect(connections).toEqual([
        {
          target: `${APP_ID}:${GUEST_SQLITE_VSOCK_PORT}`,
          match: `"${DEPLOYMENT_ID}"`,
        },
      ]);
      expect(requests).toEqual(['GET /sqlite/%2Fapp.db/v2', 'POST /sqlite/%2Fapp.db/v2/pipeline']);
    }),
  );
});

test('stopped or unowned deployments cannot open a guest tunnel', async () => {
  await run(
    Effect.gen(function* () {
      const { guest, deployments, connections } = yield* fixture;
      yield* Ref.set(deployments, [desiredInstance({ desiredState: 'stopped' })]);
      expect((yield* Effect.flip(guest.connect(QUERY)))._tag).toBe('SqliteSessionUnavailable');
      yield* Ref.set(deployments, []);
      expect((yield* Effect.flip(guest.available(QUERY)))._tag).toBe('SqliteSessionUnavailable');
      expect(connections).toEqual([]);
    }),
  );
});

test('deployment removal during connection prevents the first SQLite request', async () => {
  await run(
    Effect.gen(function* () {
      const { guest, deployments, requests, world } = yield* fixture;
      world.onConnect = () => Ref.set(deployments, []);
      const failure = yield* Effect.flip(Effect.scoped(guest.connect(QUERY)));
      expect(failure._tag).toBe('SqliteSessionUnavailable');
      expect(requests).toEqual([]);
    }),
  );
});
