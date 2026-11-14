import { Effect, Layer } from 'effect';
import { NFTABLES_FAMILIES, NFTABLES_TABLE } from '#lib/network/firewall.ts';
import { HostFirewall } from '#services/host-firewall.service.ts';

export function kernelRuleset() {
  return {
    nftables: NFTABLES_FAMILIES.flatMap((family) => [
      { table: { family, name: NFTABLES_TABLE, handle: 1 } },
      ...['input', 'forward'].flatMap((chain) => [
        {
          chain: {
            family,
            table: NFTABLES_TABLE,
            name: chain,
            hook: chain,
            type: 'filter',
            prio: 0,
            policy: 'accept',
          },
        },
        {
          rule: {
            family,
            table: NFTABLES_TABLE,
            chain,
            expr: [
              { match: { left: { meta: { key: 'iifname' } }, op: '==', right: 'nbr*' } },
              { reject: null },
            ],
          },
        },
      ]),
      { counter: { family, table: NFTABLES_TABLE, name: 'traffic', packets: 0, bytes: 0 } },
    ]),
  };
}

export const verifiedFirewall = Layer.succeed(
  HostFirewall,
  HostFirewall.make({
    apply: () => Effect.succeed(undefined),
    whileIsolated: (effect) => effect,
    traffic: Effect.succeed(new Map()),
  }),
);
