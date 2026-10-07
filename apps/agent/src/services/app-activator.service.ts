import type { AppId, HostPort } from '@repo/protocol';
import { Clock, Duration, Effect, Ref, Runtime } from 'effect';
import type { AppSlot } from '#lib/network/slot.ts';
import { forwardToGuest } from '#lib/proxy/forward.ts';
import { AppListenerFailed, waitingPort } from '#lib/proxy/listener.ts';
import { waitForApp } from '#lib/proxy/readiness.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { AppWaker } from '#services/app-waker.service.ts';

const LOOPBACK = '127.0.0.1';
const HTTP_UNAVAILABLE = 503;

/**
 * Plain and short, because a person reads it in a browser with no styling around it. It says the
 * app is down rather than unknown: the wildcard site's 404 is the answer for a hostname this host
 * serves nothing on, and a suspended app is not that.
 *
 * `connection: close` is what keeps a resume immediate. The proxy pools its upstream connections,
 * and one opened while the microVM was down was accepted *here* rather than forwarded to a guest —
 * so the forward rule appearing later cannot redirect it, and every request the proxy sends down
 * that connection is answered by this until it retires it. Refusing to be reused is what bounds
 * that to the one request already in flight.
 */
function say(message: string): Response {
  return new Response(`${message}\n`, {
    status: HTTP_UNAVAILABLE,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'close',
    },
  });
}

const sayAppIsDown = () => say('This app is not running.');
const sayAppWouldNotStart = () => say('This app could not be started.');

/**
 * Not the sentence above, because the microVM did come up: it took the request and then said
 * nothing for as long as the forward is willing to wait. An owner told their app would not start
 * would go and read a boot that worked.
 */
const sayAppDidNotAnswer = () => say('This app started but did not answer.');

/**
 * Its own sentence rather than the one above. An app that could not be woken because its host had
 * no memory left is not a broken app, and telling its visitor otherwise would have its owner
 * reading a binary that is fine — while the repair, moving the app, is not something either of
 * them can bring about by asking again.
 */
const sayHostIsFull = () => say('This app could not be started: its machine is out of memory.');

/**
 * A connection the proxy wants to upgrade cannot be carried across: what comes back from the
 * guest here is one HTTP message, and a websocket is the opposite of that. The wake still
 * happens, so the client that reconnects finds the app up and reaches it through the forward
 * rule rather than through this.
 */
const sayToComeBack = () =>
  new Response('This app is starting. Please reconnect.\n', {
    status: HTTP_UNAVAILABLE,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'retry-after': '2',
      connection: 'close',
    },
  });

type Listener = {
  readonly hostPort: HostPort;
  readonly servers: readonly ReturnType<typeof Bun.serve>[];
};

/**
 * The other end of an app's loopback port. The output-hook DNAT rewrites that port to the guest
 * before local delivery, so while the microVM is up nothing here is reached — and while it is
 * down this is what the proxy finds instead of a refused connection.
 *
 * Both listeners outlive the microVM. The second port is never forwarded, so Caddy can switch
 * to it before stopping a guest without reusing a connection routed into the outgoing guest.
 *
 * Requests that arrive during replacement wait here until the new guest is healthy. An idle
 * app is woken by its request; a suspended or failed app answers without starting anything.
 */
export class AppActivator extends Effect.Service<AppActivator>()('AppActivator', {
  scoped: Effect.gen(function* () {
    const waker = yield* AppWaker;
    const listeners = yield* Ref.make(new Map<AppId, Listener>());

    function serveGuest({
      appId,
      request,
      waking,
      woke,
    }: {
      appId: AppId;
      request: Request;
      waking: boolean;
      woke: Duration.Duration;
    }) {
      return Effect.gen(function* () {
        const woken = (yield* AgentState.snapshot).records.get(appId);
        if (!woken) {
          return sayAppWouldNotStart();
        }
        if (request.headers.get('upgrade') !== null) {
          return sayToComeBack();
        }
        const [served, response] = yield* Effect.timed(
          forwardToGuest({
            request,
            guestIpv4: woken.guestIpv4,
            httpPort: woken.httpPort,
          }),
        );
        /**
         * Both halves, because a wake ends at the guest's first TCP accept and a guest accepts
         * long before it answers: `wokeMs` alone reads as the whole cost and is the smaller part
         * of it. What the visitor paid is the two added together, and which half moved is the
         * only way to tell a slower host from a tenant that takes longer to come back.
         *
         * `servedMs` and not `answeredMs`: a state change already annotates that name with the
         * time from a start to the first probe it passed, which is a different quantity on a
         * different scale — sharing the name makes any reading of either a mix of the two.
         */
        yield* Effect.logInfo(
          waking
            ? 'app answered the request that woke it'
            : 'app answered a request held during startup',
        ).pipe(
          Effect.annotateLogs({
            appId,
            wokeMs: Duration.toMillis(woke),
            servedMs: Duration.toMillis(served),
          }),
        );
        return response;
      });
    }

    const handle = ({ appId, request }: { appId: AppId; request: Request }) =>
      Effect.gen(function* () {
        const record = yield* waitForApp(appId);
        if (!record?.desiredRunning) {
          return sayAppIsDown();
        }
        if (record.state !== 'running' && !(record.onRequest && record.state === 'idle')) {
          return sayAppWouldNotStart();
        }
        yield* AgentState.markActive({ appId, nowMs: yield* Clock.currentTimeMillis });
        const waking = record.state === 'idle';
        const [woke] = yield* Effect.timed(waking ? waker.wake(appId) : Effect.void);

        return yield* serveGuest({ appId, request, waking, woke });
      }).pipe(
        Effect.catchTag('GuestDidNotAnswer', (error) =>
          Effect.logWarning('an app did not answer the request that woke it', error)
            .pipe(Effect.annotateLogs({ appId }))
            .pipe(Effect.as(sayAppDidNotAnswer())),
        ),
        Effect.catchTag('HostHasNoRoom', (error) =>
          Effect.logWarning('a request could not be given an app', error)
            .pipe(Effect.annotateLogs({ appId }))
            .pipe(Effect.as(sayHostIsFull())),
        ),
        Effect.catchAll((error) =>
          Effect.logWarning('a request could not be given an app', error)
            .pipe(Effect.annotateLogs({ appId }))
            .pipe(Effect.as(sayAppWouldNotStart())),
        ),
      );

    type Handler = (input: { appId: AppId; request: Request }) => Promise<Response>;

    const close = (appId: AppId) =>
      Effect.gen(function* () {
        const listener = (yield* Ref.get(listeners)).get(appId);
        if (!listener) {
          return;
        }
        yield* Ref.update(listeners, (current) => {
          const remaining = new Map(current);
          remaining.delete(appId);
          return remaining;
        });
        // Not awaited: `stop` settles only once every handler has, and one holding a connection
        // open would have the agent's own shutdown wait on a tenant's client.
        yield* Effect.sync(() => {
          for (const server of listener.servers) {
            server.stop(true);
          }
        });
      });

    const listen = ({
      appId,
      hostPort,
      answer,
    }: {
      appId: AppId;
      hostPort: HostPort;
      answer: Handler;
    }) =>
      Effect.try({
        try: () => {
          const servers: ReturnType<typeof Bun.serve>[] = [];
          try {
            for (const port of [hostPort, waitingPort(hostPort)]) {
              servers.push(
                Bun.serve({
                  hostname: LOOPBACK,
                  port,
                  idleTimeout: 0,
                  fetch: (request) => answer({ appId, request }),
                }),
              );
            }
            return servers;
          } catch (cause) {
            for (const server of servers) {
              server.stop(true);
            }
            throw cause;
          }
        },
        catch: (cause) => new AppListenerFailed({ hostPort, cause }),
      }).pipe(
        Effect.tap((servers) =>
          Ref.update(listeners, (current) => new Map(current).set(appId, { hostPort, servers })),
        ),
        Effect.andThen(Effect.logInfo('app activator listening')),
        Effect.annotateLogs({ appId, hostPort }),
      );

    yield* Effect.addFinalizer(() =>
      Effect.flatMap(Ref.get(listeners), (current) =>
        Effect.forEach([...current.keys()], close, { discard: true }),
      ),
    );

    return {
      serve: Effect.fn('AppActivator.serve')(function* (
        slots: readonly Pick<AppSlot, 'appId' | 'hostPort'>[],
      ) {
        // Bun hands the handler a request and wants a promise, so the fiber's own runtime is
        // what carries the agent's services across that boundary. Taken here rather than when
        // this service is built: asking for it in the constructor would put every service a
        // wake touches into this layer's requirements, and each would then be built again.
        const runPromise = Runtime.runPromise(
          yield* Effect.runtime<Effect.Effect.Context<ReturnType<typeof handle>>>(),
        );
        const answer: Handler = (input) => runPromise(handle(input));
        const current = yield* Ref.get(listeners);
        const wanted = new Map(slots.map((slot) => [slot.appId, slot.hostPort] as const));
        for (const [appId, listener] of current) {
          if (wanted.get(appId) !== listener.hostPort) {
            yield* close(appId);
          }
        }
        yield* Effect.forEach(
          slots.filter((slot) => current.get(slot.appId)?.hostPort !== slot.hostPort),
          (slot) => listen({ ...slot, answer }),
          { discard: true },
        );
      }),
    };
  }),
  dependencies: [AppWaker.Default],
}) {}
