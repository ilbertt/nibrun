import type { AppId, HostPort } from '@repo/protocol';
import { Effect, Ref } from 'effect';
import type { AppSlot } from '#lib/network/slot.ts';

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
function sayAppIsDown(): Response {
  return new Response('This app is not running.\n', {
    status: HTTP_UNAVAILABLE,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'close',
    },
  });
}

type Listener = {
  readonly hostPort: HostPort;
  readonly server: ReturnType<typeof Bun.serve>;
};

/**
 * The other end of an app's loopback port. The output-hook DNAT rewrites that port to the guest
 * before local delivery, so while the microVM is up nothing here is reached — and while it is
 * down this is what the proxy finds instead of a refused connection.
 *
 * Bound for the life of the slot rather than the life of the microVM: the rule is what switches
 * between the two, so there is no bind to race the reconciler and no window the port is nobody's.
 *
 * The 503 is where a wake will go: a request for a sleeping microVM is the thing that has a
 * reason to start one.
 */
export class AppActivator extends Effect.Service<AppActivator>()('AppActivator', {
  scoped: Effect.gen(function* () {
    const listeners = yield* Ref.make(new Map<AppId, Listener>());

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
        yield* Effect.asVoid(Effect.sync(() => listener.server.stop(true)));
      });

    const listen = ({ appId, hostPort }: { appId: AppId; hostPort: HostPort }) =>
      Effect.try(() => Bun.serve({ hostname: LOOPBACK, port: hostPort, fetch: sayAppIsDown })).pipe(
        Effect.tap((server) =>
          Ref.update(listeners, (current) => new Map(current).set(appId, { hostPort, server })),
        ),
        Effect.andThen(Effect.logInfo('app activator listening')),
        Effect.catchAll((error) => Effect.logWarning('app activator bind failed', error)),
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
        const current = yield* Ref.get(listeners);
        const wanted = new Map(slots.map((slot) => [slot.appId, slot.hostPort] as const));
        for (const [appId, listener] of current) {
          if (wanted.get(appId) !== listener.hostPort) {
            yield* close(appId);
          }
        }
        yield* Effect.forEach(
          slots.filter((slot) => current.get(slot.appId)?.hostPort !== slot.hostPort),
          listen,
          { discard: true },
        );
      }),
    };
  }),
}) {}
