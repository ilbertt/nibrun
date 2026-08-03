import type { GuestPort, HealthCheck, Ipv4Address } from '@repo/protocol';

const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 300;

export type ProbeTarget = {
  guestIpv4: Ipv4Address;
  guestPort: GuestPort;
  healthCheck: HealthCheck;
};

/**
 * Asks the only question that matters: is the tenant's process accepting connections?
 *
 * The probe goes straight to the guest address rather than through the forwarded host port, so
 * a failure means the tenant is down and never that a NAT rule is missing. A bare TCP connect
 * is the default because it needs nothing of the tenant; a declared path upgrades it to an
 * HTTP GET that has to answer 2xx.
 */
export function probeInstance(target: ProbeTarget): Promise<boolean> {
  return target.healthCheck.path === undefined
    ? probeTcp(target)
    : probeHttp({ target, path: target.healthCheck.path });
}

async function probeTcp({ guestIpv4, guestPort, healthCheck }: ProbeTarget): Promise<boolean> {
  let socket: { end(): void } | undefined;
  try {
    const connection = await Promise.race([
      // `Bun.connect` rejects handlers carrying neither `data` nor `drain`, and the rejection
      // is indistinguishable here from a tenant that is down. The probe never reads what the
      // tenant sends: that the connection opened at all is the whole question.
      Bun.connect({ hostname: guestIpv4, port: guestPort, socket: { data: () => undefined } }),
      Bun.sleep(healthCheck.timeoutMs).then(() => undefined),
    ]);
    socket = connection;
    return connection !== undefined;
  } catch {
    return false;
  } finally {
    socket?.end();
  }
}

async function probeHttp({
  target,
  path,
}: {
  target: ProbeTarget;
  path: string;
}): Promise<boolean> {
  try {
    const response = await fetch(`http://${target.guestIpv4}:${target.guestPort}${path}`, {
      signal: AbortSignal.timeout(target.healthCheck.timeoutMs),
    });
    return response.status >= HTTP_OK_MIN && response.status < HTTP_OK_MAX;
  } catch {
    return false;
  }
}
