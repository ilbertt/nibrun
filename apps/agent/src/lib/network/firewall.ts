import type { GuestPort, HostPort, Ipv4Address } from '@repo/protocol';
import { GUEST_NETWORK_CIDR, TAP_NAME_PREFIX } from '#lib/network/slot.ts';

export const NFTABLES_TABLE = 'nibrun';
const TAP_MATCH = `"${TAP_NAME_PREFIX}*"`;

export const INSTANCE_METADATA_ADDRESS_V4 = '169.254.169.254';
export const INSTANCE_METADATA_ADDRESS_V6 = 'fd00:ec2::254';

const DNS_PORT = 53;

/** nft rejects the name `dstnat` on the output hook, and the whole ruleset with it. */
const OUTPUT_NAT_PRIORITY = -100;

const PRIVATE_DESTINATIONS_V4 = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  '127.0.0.0/8',
  '100.64.0.0/10',
] as const;

/** A tap carries a link-local v6 address from birth, and `table ip` cannot see it. */
const PRIVATE_DESTINATIONS_V6 = ['::1/128', 'fe80::/10', 'fc00::/7'] as const;

const CHAIN_INDENT = '  ';
const RULE_INDENT = '    ';

export type ForwardedInstance = {
  readonly hostPort: HostPort;
  readonly guestPort: GuestPort;
  readonly hostIpv4: Ipv4Address;
  readonly guestIpv4: Ipv4Address;
};

export type FirewallState = {
  readonly instances: readonly ForwardedInstance[];
  readonly controlPlaneCidrsV4: readonly string[];
  readonly controlPlaneCidrsV6: readonly string[];
  readonly guestDnsServers: readonly string[];
};

const set = (values: readonly string[]) => `{ ${values.join(', ')} }`;

const chain = ({ header, rules }: { header: string; rules: readonly string[] }) => [
  `${CHAIN_INDENT}chain ${header}`,
  ...rules.map((rule) => `${RULE_INDENT}${rule}`),
  `${CHAIN_INDENT}}`,
];

const resolverRules = (guestDnsServers: readonly string[]) =>
  guestDnsServers.flatMap((server) => [
    `iifname ${TAP_MATCH} ip daddr ${server} udp dport ${DNS_PORT} accept`,
    `iifname ${TAP_MATCH} ip daddr ${server} tcp dport ${DNS_PORT} accept`,
  ]);

/**
 * Rendered whole and applied with `nft -f`, so the rules are a function of state rather than a
 * history of edits: no incremental add can be missed and a rerun converges.
 */
export function renderRuleset(state: FirewallState): string {
  return `${[
    `table ip ${NFTABLES_TABLE}`,
    `delete table ip ${NFTABLES_TABLE}`,
    '',
    `table ip ${NFTABLES_TABLE} {`,
    ...forwardChainV4(state),
    '',
    ...inputChainV4(state),
    '',
    ...natChainsV4(state),
    '}',
    '',
    `table ip6 ${NFTABLES_TABLE}`,
    `delete table ip6 ${NFTABLES_TABLE}`,
    '',
    `table ip6 ${NFTABLES_TABLE} {`,
    ...forwardChainV6(state),
    '',
    ...inputChainV6(),
    '}',
  ].join('\n')}\n`;
}

function forwardChainV4({ controlPlaneCidrsV4, guestDnsServers }: FirewallState): string[] {
  return chain({
    header: 'forward {',
    rules: [
      'type filter hook forward priority filter; policy accept;',
      'ct state established,related accept',
      ...resolverRules(guestDnsServers),
      `iifname ${TAP_MATCH} ip daddr ${INSTANCE_METADATA_ADDRESS_V4} drop comment "instance metadata endpoint"`,
      `iifname ${TAP_MATCH} oifname ${TAP_MATCH} drop comment "guest to guest"`,
      `iifname ${TAP_MATCH} ip daddr ${GUEST_NETWORK_CIDR} drop comment "guest to guest"`,
      ...controlPlaneCidrsV4.map(
        (cidr) => `iifname ${TAP_MATCH} ip daddr ${cidr} drop comment "control plane"`,
      ),
      `iifname ${TAP_MATCH} ip daddr ${set(PRIVATE_DESTINATIONS_V4)} drop comment "private destinations"`,
    ],
  });
}

/** Guest traffic to the host's own tap address never reaches the forward hook. */
function inputChainV4({ guestDnsServers }: FirewallState): string[] {
  return chain({
    header: 'input {',
    rules: [
      'type filter hook input priority filter; policy accept;',
      `iifname ${TAP_MATCH} ct state established,related accept`,
      ...resolverRules(guestDnsServers),
      `iifname ${TAP_MATCH} drop comment "guest to host"`,
    ],
  });
}

/** AWS allocates VPC IPv6 from global unicast, so only the named rule denies the control plane. */
function forwardChainV6({ controlPlaneCidrsV6 }: FirewallState): string[] {
  return chain({
    header: 'forward {',
    rules: [
      'type filter hook forward priority filter; policy accept;',
      'ct state established,related accept',
      `iifname ${TAP_MATCH} ip6 daddr ${INSTANCE_METADATA_ADDRESS_V6} drop comment "instance metadata endpoint"`,
      `iifname ${TAP_MATCH} oifname ${TAP_MATCH} drop comment "guest to guest"`,
      ...controlPlaneCidrsV6.map(
        (cidr) => `iifname ${TAP_MATCH} ip6 daddr ${cidr} drop comment "control plane"`,
      ),
      `iifname ${TAP_MATCH} ip6 daddr ${set(PRIVATE_DESTINATIONS_V6)} drop comment "private destinations"`,
    ],
  });
}

function inputChainV6(): string[] {
  return chain({
    header: 'input {',
    rules: [
      'type filter hook input priority filter; policy accept;',
      `iifname ${TAP_MATCH} ct state established,related accept`,
      `iifname ${TAP_MATCH} drop comment "guest to host"`,
    ],
  });
}

function natChainsV4({ instances }: FirewallState): string[] {
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
        // A loopback source address is unreplyable from the guest, so it is re-sourced onto the tap.
        ...instances.map(
          (instance) =>
            `oifname ${TAP_MATCH} ip saddr 127.0.0.0/8 ip daddr ${instance.guestIpv4} snat to ${instance.hostIpv4}`,
        ),
        `ip saddr ${GUEST_NETWORK_CIDR} oifname != ${TAP_MATCH} masquerade`,
      ],
    }),
  ];
}
