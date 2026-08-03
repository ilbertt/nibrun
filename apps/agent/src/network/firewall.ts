import type { GuestPort, HostPort, Ipv4Address } from '@repo/protocol';
import { GUEST_NETWORK_CIDR, TAP_NAME_PREFIX } from '#network/allocator.ts';

export const NFTABLES_TABLE = 'nibrun';
const TAP_MATCH = `"${TAP_NAME_PREFIX}*"`;

export const INSTANCE_METADATA_ADDRESS = '169.254.169.254';

const DNS_PORT = 53;

// NF_IP_PRI_NAT_DST — what `dstnat` resolves to where the name is allowed.
const OUTPUT_NAT_PRIORITY = -100;

// The blanket rule that makes the three isolation guarantees hold even for a destination
// nobody thought to enumerate. Every one of these is somewhere a tenant has no business
// reaching from inside a microVM.
const PRIVATE_DESTINATIONS = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  '127.0.0.0/8',
  '100.64.0.0/10',
] as const;

const CHAIN_INDENT = '  ';
const RULE_INDENT = '    ';

export type ForwardedInstance = {
  hostPort: HostPort;
  guestPort: GuestPort;
  hostIpv4: Ipv4Address;
  guestIpv4: Ipv4Address;
};

export type FirewallState = {
  instances: ForwardedInstance[];
  controlPlaneCidrs: readonly string[];
  guestDnsServers: readonly string[];
};

const set = (values: readonly string[]) => `{ ${values.join(', ')} }`;

const chain = ({ header, rules }: { header: string; rules: readonly string[] }) => [
  `${CHAIN_INDENT}chain ${header}`,
  ...rules.map((rule) => `${RULE_INDENT}${rule}`),
  `${CHAIN_INDENT}}`,
];

/**
 * The whole ruleset, rendered as one file and applied with `nft -f`.
 *
 * Rendering everything and replacing the table in a single transaction is what keeps the rules
 * a function of state rather than a history of edits: there is no incremental add or delete
 * that can be missed, and a reconcile that runs twice produces the same kernel state.
 *
 * The metadata-endpoint rule is written explicitly even though the instance's IMDS hop limit
 * of 1 already defeats routed guest traffic. A guarantee that holds only while nobody changes
 * an instance attribute is not a guarantee, and the credentials it protects are the host's own
 * role — the most valuable thing on the machine.
 */
export function renderRuleset(state: FirewallState): string {
  const lines: string[] = [
    `table ip ${NFTABLES_TABLE}`,
    `delete table ip ${NFTABLES_TABLE}`,
    '',
    `table ip ${NFTABLES_TABLE} {`,
    ...forwardChain(state),
    '',
    ...inputChain(state),
    '',
    ...natChains(state),
    '}',
  ];
  return `${lines.join('\n')}\n`;
}

function forwardChain({ controlPlaneCidrs, guestDnsServers }: FirewallState): string[] {
  return chain({
    header: 'forward {',
    rules: [
      'type filter hook forward priority filter; policy accept;',
      'ct state established,related accept',
      ...guestDnsServers.flatMap((server) => [
        `iifname ${TAP_MATCH} ip daddr ${server} udp dport ${DNS_PORT} accept`,
        `iifname ${TAP_MATCH} ip daddr ${server} tcp dport ${DNS_PORT} accept`,
      ]),
      `iifname ${TAP_MATCH} ip daddr ${INSTANCE_METADATA_ADDRESS} drop comment "instance metadata endpoint"`,
      `iifname ${TAP_MATCH} oifname ${TAP_MATCH} drop comment "guest to guest"`,
      `iifname ${TAP_MATCH} ip daddr ${GUEST_NETWORK_CIDR} drop comment "guest to guest"`,
      ...controlPlaneCidrs.map(
        (cidr) => `iifname ${TAP_MATCH} ip daddr ${cidr} drop comment "control plane"`,
      ),
      `iifname ${TAP_MATCH} ip daddr ${set(PRIVATE_DESTINATIONS)} drop comment "private destinations"`,
    ],
  });
}

// Traffic from a guest to the host's own tap address never reaches the forward hook, so the
// three isolation rules would leave every service listening on the host exposed to tenants.
function inputChain({ guestDnsServers }: FirewallState): string[] {
  return chain({
    header: 'input {',
    rules: [
      'type filter hook input priority filter; policy accept;',
      `iifname ${TAP_MATCH} ct state established,related accept`,
      ...guestDnsServers.map((server) => `iifname ${TAP_MATCH} ip daddr ${server} accept`),
      `iifname ${TAP_MATCH} drop comment "guest to host"`,
    ],
  });
}

function natChains({ instances }: FirewallState): string[] {
  return [
    ...chain({
      header: 'prerouting {',
      rules: [
        'type nat hook prerouting priority dstnat; policy accept;',
        ...instances.map(
          (instance) =>
            `iifname != ${TAP_MATCH} tcp dport ${instance.hostPort} dnat to ${instance.guestIpv4}:${instance.guestPort}`,
        ),
      ],
    }),
    '',
    ...chain({
      header: 'output {',
      rules: [
        // The numeric value of dstnat, because the name is only accepted on prerouting: nft
        // rejects `priority dstnat` on the output hook outright, and the whole ruleset with it.
        `type nat hook output priority ${OUTPUT_NAT_PRIORITY}; policy accept;`,
        ...instances.map(
          (instance) =>
            `ip daddr 127.0.0.1 tcp dport ${instance.hostPort} dnat to ${instance.guestIpv4}:${instance.guestPort}`,
        ),
      ],
    }),
    '',
    ...chain({
      header: 'postrouting {',
      rules: [
        'type nat hook postrouting priority srcnat; policy accept;',
        // The host's own connections to a forwarded port leave with a loopback source address,
        // which the guest cannot reply to. They are re-sourced onto the tap they leave by.
        ...instances.map(
          (instance) =>
            `oifname ${TAP_MATCH} ip saddr 127.0.0.0/8 ip daddr ${instance.guestIpv4} snat to ${instance.hostIpv4}`,
        ),
        `ip saddr ${GUEST_NETWORK_CIDR} oifname != ${TAP_MATCH} masquerade`,
      ],
    }),
  ];
}
