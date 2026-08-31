import type { Ipv4Address } from '@repo/protocol';
import { Effect } from 'effect';
import { TAP_NAME_PREFIX } from '#lib/network/slot.ts';
import { stdoutOf } from '#services/command-runner.service.ts';

const IP = 'ip';
const SYSCTL = 'sysctl';

export function parseLinkNames(output: string): string[] {
  const parsed: unknown = JSON.parse(output);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .map((entry) => (entry as { ifname?: unknown }).ifname)
    .filter((name): name is string => typeof name === 'string');
}

export const isTapName = (name: string) =>
  name.startsWith(TAP_NAME_PREFIX) && /^\d+$/.test(name.slice(TAP_NAME_PREFIX.length));

export const listTapNames = Effect.map(
  stdoutOf({ command: [IP, '-json', 'link', 'show'] }),
  (output) => parseLinkNames(output).filter(isTapName),
);

export type TapInterface = {
  readonly tapName: string;
  readonly hostIpv4: Ipv4Address;
  readonly subnetPrefixLength: number;
};

export const ensureTap = Effect.fn('ensureTap')(function* (tap: TapInterface) {
  yield* Effect.annotateCurrentSpan({ tapName: tap.tapName });
  const existing = yield* listTapNames;
  if (!existing.includes(tap.tapName)) {
    yield* stdoutOf({ command: [IP, 'tuntap', 'add', 'dev', tap.tapName, 'mode', 'tap'] });
  }
  // `replace` rather than `add`, so a converged host re-runs this to no effect.
  yield* stdoutOf({
    command: [
      IP,
      'addr',
      'replace',
      `${tap.hostIpv4}/${tap.subnetPrefixLength}`,
      'dev',
      tap.tapName,
    ],
  });
  yield* stdoutOf({ command: [IP, 'link', 'set', 'dev', tap.tapName, 'up'] });
  // Without this the kernel drops replies to the forwarded 127.0.0.1 port as martian, before
  // the nftables SNAT can rewrite them — and the local proxy reaches every app that way.
  yield* stdoutOf({ command: [SYSCTL, '-w', `net.ipv4.conf.${tap.tapName}.route_localnet=1`] });
});

/**
 * The host's neighbour entry for a guest goes stale while its microVM is down, and the first
 * connection after a wake then pays ARP re-resolution: 1.1s against the 112ms a refreshed entry
 * costs, which is most of what makes waking cheaper than the ~1035ms of a cold boot. A guest
 * keeps its address and its MAC across a sleep, so this writes back the pairing that was already
 * there rather than announcing a new one.
 */
export const refreshNeighbour = Effect.fn('refreshNeighbour')(
  ({
    guestIpv4,
    guestMac,
    tapName,
  }: {
    guestIpv4: Ipv4Address;
    guestMac: string;
    tapName: string;
  }) =>
    stdoutOf({
      command: [
        IP,
        'neigh',
        'replace',
        guestIpv4,
        'lladdr',
        guestMac,
        'dev',
        tapName,
        'nud',
        'reachable',
      ],
    }),
);
