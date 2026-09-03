import { HttpClient } from '@effect/platform';
import type { HealthCheck, HttpPort, Ipv4Address } from '@repo/protocol';
import { Duration, Effect } from 'effect';

const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 300;

export type ProbeTarget = {
  readonly guestIpv4: Ipv4Address;
  readonly httpPort: HttpPort;
  readonly healthCheck: HealthCheck;
};

/**
 * Straight to the guest address rather than through the forwarded host port, so a failure means
 * the tenant is down and never that a NAT rule is missing.
 */
export const probeInstance = (target: ProbeTarget) =>
  unhealthyUnless({
    probe:
      target.healthCheck.path === undefined
        ? probeTcp(target)
        : probeHttp({ target, path: target.healthCheck.path }),
    timeoutMs: target.healthCheck.timeoutMs,
  });

const unhealthyUnless = ({
  probe,
  timeoutMs,
}: {
  probe: Effect.Effect<boolean, unknown, HttpClient.HttpClient>;
  timeoutMs: number;
}) =>
  probe.pipe(
    // As in `CommandRunner` and `isFormatted`: the connect is a promise this side cannot recall,
    // so without this the deadline is the moment the *socket* gives up rather than the moment this
    // stops waiting — an address nothing answers on is bounded by the kernel's connect timeout,
    // not by `timeoutMs`. A guest whose tap has gone is exactly that address, and a pass waiting
    // on one is a pass reporting nothing about any app on the host.
    Effect.disconnect,
    Effect.timeoutTo({
      duration: Duration.millis(timeoutMs),
      onSuccess: (healthy: boolean) => healthy,
      onTimeout: () => false,
    }),
    Effect.orElseSucceed(() => false),
  );

/** That the connection opened at all is the whole question; nothing the tenant sends is read. */
const probeTcp = ({ guestIpv4, httpPort }: ProbeTarget) =>
  Effect.acquireUseRelease(
    Effect.tryPromise(() =>
      Bun.connect({ hostname: guestIpv4, port: httpPort, socket: { data: () => undefined } }),
    ),
    () => Effect.succeed(true),
    (socket) => Effect.sync(() => socket.end()),
  );

const probeHttp = ({ target, path }: { target: ProbeTarget; path: string }) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.get(`http://${target.guestIpv4}:${target.httpPort}${path}`);
    return response.status >= HTTP_OK_MIN && response.status < HTTP_OK_MAX;
  }).pipe(Effect.scoped);
