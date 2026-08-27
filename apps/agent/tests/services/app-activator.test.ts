import { describe, expect, test } from 'bun:test';
import { connect } from 'node:net';
import { AppIdSchema, type HostPort, HostPortSchema, Value } from '@repo/protocol';
import { Duration, Effect, Either } from 'effect';
import { AppActivator } from '#services/app-activator.service.ts';
import { APP_ID } from '#tests/support/fixtures.ts';
import { provided } from '#tests/support/run.ts';
import { HTTP_UNAVAILABLE } from '#tests/support/server.ts';

const OTHER_APP_ID = Value.Parse(AppIdSchema, 'app-2');
const LOOPBACK = '127.0.0.1';

const run = provided(AppActivator.Default);

/**
 * A port the kernel has just handed out and taken back, rather than the one an app's slot really
 * carries: a test must not need 21000 to be free on whatever machine runs it.
 */
function unusedPort(): HostPort {
  const probe = Bun.serve({ hostname: LOOPBACK, port: 0, fetch: () => new Response() });
  const port = Value.Parse(HostPortSchema, Number(probe.port));
  probe.stop(true);
  return port;
}

function get(hostPort: HostPort) {
  return Effect.tryPromise(() => fetch(`http://${LOOPBACK}:${hostPort}/`));
}

const REUSE_TIMEOUT_SECONDS = 5;

/**
 * Whether the connection may be reused is hop-by-hop, so `fetch` never surfaces it and the socket
 * has to be spoken to directly. Resolves with everything read, once the server hangs up.
 */
function untilServerHangsUp(hostPort: HostPort) {
  return Effect.tryPromise(() => {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    let received = '';
    const socket = connect({ host: LOOPBACK, port: hostPort }, () => {
      socket.write('GET / HTTP/1.1\r\nHost: activator\r\n\r\n');
    });
    socket.on('data', (chunk: Buffer) => {
      received += chunk.toString();
    });
    socket.on('close', () => resolve(received));
    socket.on('error', reject);
    return promise;
  });
}

describe('an app that is down answers for itself', () => {
  test('a request the microVM is not there to take is answered rather than refused', () =>
    run(
      Effect.gen(function* () {
        const activator = yield* AppActivator;
        const hostPort = unusedPort();
        yield* activator.serve([{ appId: APP_ID, hostPort }]);

        const response = yield* get(hostPort);

        expect(response.status).toBe(HTTP_UNAVAILABLE);
        expect(yield* Effect.promise(() => response.text())).toContain('not running');
      }),
    ));

  test('the port survives a sync that changes nothing, so nothing goes out under it', () =>
    run(
      Effect.gen(function* () {
        const activator = yield* AppActivator;
        const hostPort = unusedPort();
        const slots = [{ appId: APP_ID, hostPort }];
        yield* activator.serve(slots);
        yield* activator.serve(slots);

        expect((yield* get(hostPort)).status).toBe(HTTP_UNAVAILABLE);
      }),
    ));

  test('a slot the host no longer holds stops being answered for', () =>
    run(
      Effect.gen(function* () {
        const activator = yield* AppActivator;
        const hostPort = unusedPort();
        yield* activator.serve([{ appId: APP_ID, hostPort }]);
        yield* activator.serve([{ appId: OTHER_APP_ID, hostPort: unusedPort() }]);

        expect(Either.isLeft(yield* Effect.either(get(hostPort)))).toBe(true);
      }),
    ));

  test('the answer is not reusable, so the proxy cannot keep asking a microVM that is back', () =>
    run(
      Effect.gen(function* () {
        const activator = yield* AppActivator;
        const hostPort = unusedPort();
        yield* activator.serve([{ appId: APP_ID, hostPort }]);

        // The server hanging up is the assertion: this resolves on close, so a connection left
        // open to be reused times out here instead.
        const answer = yield* untilServerHangsUp(hostPort).pipe(
          Effect.timeout(Duration.seconds(REUSE_TIMEOUT_SECONDS)),
        );

        expect(answer.toLowerCase()).toContain('connection: close');
      }),
    ));
});
