import { describe, expect, test } from 'bun:test';
import { connect } from 'node:net';
import {
  type AppId,
  AppIdSchema,
  type HostPort,
  HostPortSchema,
  HttpPortSchema,
  Ipv4AddressSchema,
  Value,
} from '@repo/protocol';
import { Duration, Effect, Either, Layer } from 'effect';
import { AgentState } from '#services/agent-state.service.ts';
import { AppActivator } from '#services/app-activator.service.ts';
import { AppWaker, HostHasNoRoom, WakeFailed } from '#services/app-waker.service.ts';
import { APP_ID, instanceRecord } from '#tests/support/fixtures.ts';
import { provided } from '#tests/support/run.ts';
import { HTTP_OK, HTTP_UNAVAILABLE, serving } from '#tests/support/server.ts';

const OTHER_APP_ID = Value.Parse(AppIdSchema, 'app-2');
const SHORT_BY_MIB = 256;
const LOOPBACK = '127.0.0.1';

/** Nothing here has a microVM to be woken, so a waker that would boot one is not the subject. */
const neverWoken = Layer.succeed(AppWaker, AppWaker.make({ wake: () => Effect.void }));

const activator = (waker: Layer.Layer<AppWaker>) =>
  provided(
    Layer.mergeAll(
      AppActivator.DefaultWithoutDependencies.pipe(Layer.provide(waker)),
      AgentState.Default,
    ),
  );

const run = activator(neverWoken);

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

/**
 * The half of this that only an app running on request has: the request is not refused, it is
 * what starts the microVM, and it is answered from that microVM once it is up. What stands in
 * for the guest here is a real listener on the address the record names, because the thing being
 * checked is that a request came out of the far side.
 */
describe('an app that runs on request is started by the request that wanted it', () => {
  function guest(handler: (request: Request) => Response | Promise<Response>) {
    return Effect.flatMap(serving(handler), ({ port }) =>
      Effect.gen(function* () {
        const record = instanceRecord({
          onRequest: true,
          state: 'idle',
          guestIpv4: Value.Parse(Ipv4AddressSchema, LOOPBACK),
          httpPort: Value.Parse(HttpPortSchema, port),
        });
        yield* AgentState.putRecord(record);
        return record;
      }),
    );
  }

  /** Records who was asked to wake, so a request that reached a guest without one is visible. */
  function wakes() {
    const woken: AppId[] = [];
    return {
      woken,
      layer: Layer.succeed(
        AppWaker,
        AppWaker.make({
          wake: (appId: AppId) => Effect.sync(() => void woken.push(appId)),
        }),
      ),
    };
  }

  test('the request waits for the wake and is answered by the guest that comes up', () => {
    const waker = wakes();
    return activator(waker.layer)(
      Effect.gen(function* () {
        const app = yield* AppActivator;
        yield* guest(() => new Response('served by the tenant', { status: HTTP_OK }));
        const hostPort = unusedPort();
        yield* app.serve([{ appId: APP_ID, hostPort }]);

        const response = yield* get(hostPort);

        expect(response.status).toBe(HTTP_OK);
        expect(yield* Effect.promise(() => response.text())).toBe('served by the tenant');
        expect(waker.woken).toEqual([APP_ID]);
      }),
    );
  });

  // The forward rule takes over the moment the microVM is up, and a connection the proxy keeps
  // open to here would go on being answered here instead — the same reuse that had a resumed app
  // still reading as down.
  test('the answer is not reusable, so the proxy takes the forward rule instead', () =>
    activator(wakes().layer)(
      Effect.gen(function* () {
        const app = yield* AppActivator;
        yield* guest(() => new Response('served by the tenant'));
        const hostPort = unusedPort();
        yield* app.serve([{ appId: APP_ID, hostPort }]);

        const answer = yield* untilServerHangsUp(hostPort).pipe(
          Effect.timeout(Duration.seconds(REUSE_TIMEOUT_SECONDS)),
        );

        expect(answer.toLowerCase()).toContain('connection: close');
      }),
    ));

  test('a microVM that would not start is said to have not started', () => {
    const refusing = Layer.succeed(
      AppWaker,
      AppWaker.make({
        wake: (appId: AppId) => new WakeFailed({ appId, reason: 'no slots left on this host' }),
      }),
    );
    return activator(refusing)(
      Effect.gen(function* () {
        const app = yield* AppActivator;
        yield* AgentState.putRecord(instanceRecord({ onRequest: true, state: 'idle' }));
        const hostPort = unusedPort();
        yield* app.serve([{ appId: APP_ID, hostPort }]);

        const response = yield* get(hostPort);

        expect(response.status).toBe(HTTP_UNAVAILABLE);
        expect(yield* Effect.promise(() => response.text())).toContain('could not be started');
      }),
    );
  });

  /**
   * A host with no memory left is not a broken app, and the visitor is not told it is one: an
   * owner sent to read a binary that is fine would find nothing, because the repair is to move
   * the app and neither of them can bring that about by asking again.
   */
  test('a wake refused for want of memory says so rather than blaming the app', () => {
    const full = Layer.succeed(
      AppWaker,
      AppWaker.make({
        wake: (appId: AppId) => new HostHasNoRoom({ appId, shortfallMib: SHORT_BY_MIB }),
      }),
    );
    return activator(full)(
      Effect.gen(function* () {
        const app = yield* AppActivator;
        yield* AgentState.putRecord(instanceRecord({ onRequest: true, state: 'idle' }));
        const hostPort = unusedPort();
        yield* app.serve([{ appId: APP_ID, hostPort }]);

        const response = yield* get(hostPort);

        expect(response.status).toBe(HTTP_UNAVAILABLE);
        expect(yield* Effect.promise(() => response.text())).toContain('out of memory');
      }),
    );
  });

  // Suspending is an answer, not a question. A request is not the thing that reverses it, so the
  // one that arrives is told the app is down rather than quietly starting it again.
  test('a suspended app is not woken by somebody finding its hostname', () => {
    const waker = wakes();
    return activator(waker.layer)(
      Effect.gen(function* () {
        const app = yield* AppActivator;
        yield* AgentState.putRecord(
          instanceRecord({ onRequest: true, state: 'stopped', desiredRunning: false }),
        );
        const hostPort = unusedPort();
        yield* app.serve([{ appId: APP_ID, hostPort }]);

        expect((yield* get(hostPort)).status).toBe(HTTP_UNAVAILABLE);
        expect(waker.woken).toEqual([]);
      }),
    );
  });
});
