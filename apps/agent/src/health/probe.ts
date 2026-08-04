import { HttpClient } from '@effect/platform';
import type { GuestPort, HealthCheck, Ipv4Address } from '@repo/protocol';
import { Duration, Effect } from 'effect';

const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 300;

export type ProbeTarget = {
  readonly guestIpv4: Ipv4Address;
  readonly guestPort: GuestPort;
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
    Effect.timeoutTo({
      duration: Duration.millis(timeoutMs),
      onSuccess: (healthy: boolean) => healthy,
      onTimeout: () => false,
    }),
    Effect.orElseSucceed(() => false),
  );

/** That the connection opened at all is the whole question; nothing the tenant sends is read. */
const probeTcp = ({ guestIpv4, guestPort }: ProbeTarget) =>
  Effect.acquireUseRelease(
    Effect.tryPromise(() =>
      Bun.connect({ hostname: guestIpv4, port: guestPort, socket: { data: () => undefined } }),
    ),
    () => Effect.succeed(true),
    (socket) => Effect.sync(() => socket.end()),
  );

const probeHttp = ({ target, path }: { target: ProbeTarget; path: string }) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.get(`http://${target.guestIpv4}:${target.guestPort}${path}`);
    return response.status >= HTTP_OK_MIN && response.status < HTTP_OK_MAX;
  }).pipe(Effect.scoped);
