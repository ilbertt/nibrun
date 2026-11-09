import { expect, test } from 'bun:test';
import { createServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { Effect, Fiber } from 'effect';
import { connectNibrunnerGuest } from '#lib/nibrunner/guest-connection.ts';
import { APP_ID, DEPLOYMENT_ID } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';
import { HTTP_OK } from '#tests/support/server.ts';

const run = provided(platform);
const PORT = 51099;
const PRECONDITION_FAILED = 412;

const fixture = Effect.gen(function* () {
  const socketPath = `${yield* temporaryDirectory}/guest.sock`;
  const seen: Array<{ target: string | undefined; match: string | undefined }> = [];
  const world: { status: number | undefined } = { status: HTTP_OK };
  const observed = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  const sockets = new Set<Duplex>();
  const server = createServer();
  // biome-ignore lint/complexity/useMaxParams: Node supplies the CONNECT request and its stream.
  server.on('connect', (request, socket) => {
    sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      sockets.delete(socket);
      closed.resolve();
    });
    seen.push({ target: request.url, match: request.headers['if-match'] });
    observed.resolve();
    if (world.status !== undefined) {
      socket.write(`HTTP/1.1 ${world.status} Connection\r\n\r\nwelcome`);
    }
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
  return {
    input: { socketPath, appId: APP_ID, deploymentId: DEPLOYMENT_ID, port: PORT },
    seen,
    world,
    observed: observed.promise,
    closed: closed.promise,
  };
});

function firstBytes(stream: Duplex) {
  return Effect.async<string>((resume) => {
    stream.once('data', (bytes) => resume(Effect.succeed(bytes.toString())));
    stream.resume();
  }).pipe(Effect.timeout('2 seconds'));
}

test('CONNECT fences the deployment and retains bytes received with its response', async () => {
  await run(
    Effect.gen(function* () {
      const { input, seen } = yield* fixture;
      const held = yield* Effect.scoped(
        Effect.gen(function* () {
          const stream = yield* connectNibrunnerGuest(input);
          expect(yield* firstBytes(stream)).toBe('welcome');
          return stream;
        }),
      );
      expect(held.destroyed).toBe(true);
      expect(seen).toEqual([{ target: `${APP_ID}:${PORT}`, match: `"${DEPLOYMENT_ID}"` }]);
    }),
  );
});

test('a refused deployment fails without returning a stream', async () => {
  await run(
    Effect.gen(function* () {
      const { input, world } = yield* fixture;
      world.status = PRECONDITION_FAILED;
      expect((yield* Effect.flip(connectNibrunnerGuest(input)))._tag).toBe(
        'NibrunnerGuestUnavailable',
      );
    }),
  );
});

test('cancelling a silent handshake closes the connection', async () => {
  await run(
    Effect.gen(function* () {
      const { input, world, observed, closed } = yield* fixture;
      world.status = undefined;
      const waiting = yield* connectNibrunnerGuest(input).pipe(Effect.forkScoped);
      yield* Effect.promise(() => observed);
      yield* Fiber.interrupt(waiting);
      yield* Effect.promise(() => closed).pipe(Effect.timeout('2 seconds'));
    }),
  );
});
