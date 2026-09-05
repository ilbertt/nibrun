import { describe, expect, test } from 'bun:test';
import { HttpPortSchema, Ipv4AddressSchema, Value } from '@repo/protocol';
import { Duration, Effect, Fiber, TestClock, TestContext } from 'effect';
import { forwardToGuest, GuestDidNotAnswer } from '#lib/proxy/forward.ts';
import { runScoped } from '#tests/support/run.ts';
import { HTTP_OK, serving } from '#tests/support/server.ts';

const LOOPBACK = '127.0.0.1';
const GUEST_IPV4 = Value.Parse(Ipv4AddressSchema, LOOPBACK);
const VISITED = 'http://app.example.dev/';

/** Virtual, so the deadline is what the test waits out rather than the test's own patience. */
const LONGER_THAN_ANY_DEADLINE_MINUTES = 5;
const LONGER_THAN_ANY_DEADLINE = Duration.minutes(LONGER_THAN_ANY_DEADLINE_MINUTES);

/**
 * A guest that accepts the connection and answers nothing, which is the one this deadline is for:
 * a refused connection fails on its own, and only an accepted one waits forever.
 *
 * The accept is handed back because the clock here is virtual — moved before the forward had
 * registered anything against it, it would pass over a deadline nobody was waiting on yet.
 */
function silentGuest() {
  const accepted = Promise.withResolvers<void>();
  return Effect.map(
    Effect.acquireRelease(
      Effect.sync(() =>
        Bun.listen({
          hostname: LOOPBACK,
          port: 0,
          socket: { open: () => accepted.resolve(), data: () => undefined },
        }),
      ),
      (listener) => Effect.sync(() => listener.stop(true)),
    ),
    (listener) => ({
      httpPort: Value.Parse(HttpPortSchema, listener.port),
      accepted: Effect.promise(() => accepted.promise),
    }),
  );
}

describe('a guest that took the request that woke it and said nothing is given up on', () => {
  test('the wait is the deadline rather than however long the guest stays silent', () =>
    runScoped(
      Effect.gen(function* () {
        const guest = yield* silentGuest();
        const forwarding = yield* Effect.fork(
          forwardToGuest({
            request: new Request(VISITED),
            guestIpv4: GUEST_IPV4,
            httpPort: guest.httpPort,
          }),
        );
        yield* guest.accepted;

        yield* TestClock.adjust(LONGER_THAN_ANY_DEADLINE);

        const failure = yield* Effect.flip(Fiber.join(forwarding));
        expect(failure).toBeInstanceOf(GuestDidNotAnswer);
      }).pipe(Effect.provide(TestContext.TestContext)),
    ));

  test('and one that does answer is still answered from', () =>
    runScoped(
      Effect.gen(function* () {
        const guest = yield* serving(() => new Response('served by the tenant'));

        const response = yield* forwardToGuest({
          request: new Request(VISITED),
          guestIpv4: GUEST_IPV4,
          httpPort: Value.Parse(HttpPortSchema, guest.port),
        });

        expect(response.status).toBe(HTTP_OK);
        expect(yield* Effect.promise(() => response.text())).toBe('served by the tenant');
      }),
    ));
});
