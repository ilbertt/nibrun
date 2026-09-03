import type { AppId, HostPort, HttpPort, Ipv4Address } from '@repo/protocol';
import { GUEST_NETWORK_CIDR, TAP_NAME_PREFIX } from '#lib/network/slot.ts';

export const NFTABLES_TABLE = 'nibrun';

/** The families `renderRuleset` writes, and so the ones a kernel still holding it answers with. */
export const NFTABLES_FAMILIES = ['ip', 'ip6'] as const;

export type NftablesFamily = (typeof NFTABLES_FAMILIES)[number];

const TAP_MATCH = `"${TAP_NAME_PREFIX}*"`;

export const INSTANCE_METADATA_ADDRESS_V4 = '169.254.169.254';
export const INSTANCE_METADATA_ADDRESS_V6 = 'fd00:ec2::254';

/** nft rejects the name `dstnat` on the output hook, and the whole ruleset with it. */
const OUTPUT_NAT_PRIORITY = -100;

/** After the isolation chain on the same hook, so only traffic that was allowed is counted. */
const TRAFFIC_CHAIN_PRIORITY = 'filter + 10';

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

/**
 * One verdict for every isolation rule, so none of them can silently be the odd one out.
 *
 * `reject` rather than `drop`: a dropped packet is indistinguishable from a slow one, so a tenant
 * reaching a denied address waits out its own timeout with nothing logged — and on a one-vCPU
 * guest one stuck call is enough to starve a runtime's IO threads. Staying silent hides only that
 * a filter exists, which the addresses a guest cannot reach already tell it.
 */
const DENY = 'reject';

/**
 * A named counter per app, referenced from every chain that sees traffic reaching its guest. The
 * name carries the attribution, so reading one back needs no rule to be recognised by its shape
 * and no two rules have to be summed to answer for one app.
 *
 * Bare, not quoted: nft takes a declaration name as an identifier and rejects a quoted string
 * there, hyphens in an app id notwithstanding.
 */
export const appCounterName = (appId: AppId) => `app_${appId}`;

export type ForwardedInstance = {
  readonly appId: AppId;
  readonly hostPort: HostPort;
  readonly httpPort: HttpPort;
  /** Absent unless the app asked for one, which is what keeps a port off every app that did not. */
  readonly extraPublicPort?: HostPort;
  readonly hostIpv4: Ipv4Address;
  readonly guestIpv4: Ipv4Address;
};

export type FirewallState = {
  readonly instances: readonly ForwardedInstance[];
  readonly controlPlaneCidrsV4: readonly string[];
  readonly controlPlaneCidrsV6: readonly string[];
};

const set = (values: readonly string[]) => `{ ${values.join(', ')} }`;

/**
 * Zeroed whenever the ruleset changes, because the table is replaced rather than edited. Whoever
 * reads these has to treat a count standing below the one before it as a reset and not as an app
 * that has gone quiet — the same hazard a rebooted guest is to a cpu share.
 *
 * Deliberately not counted on the nat rules that forward to a guest. A nat hook is traversed for
 * the packet that creates a conntrack entry and no other, so a count taken there is a count of
 * connections: measured on a live host, twenty requests over one keep-alive connection moved it
 * by one, against the tap's own forty-two thousand. An app being read through a pooled connection
 * or holding a websocket open would have looked idle, and idle is the direction that puts a
 * microVM down underneath somebody.
 */
const counterObjects = ({ instances }: FirewallState) =>
  instances.flatMap((instance) => [
    `${CHAIN_INDENT}counter ${appCounterName(instance.appId)} {`,
    `${CHAIN_INDENT}}`,
    '',
  ]);

const chain = ({ header, rules }: { header: string; rules: readonly string[] }) => [
  `${CHAIN_INDENT}chain ${header}`,
  ...rules.map((rule) => `${RULE_INDENT}${rule}`),
  `${CHAIN_INDENT}}`,
];

/**
 * Declared and deleted before being written, which is what makes the same text apply to a host
 * that has the table and one that does not. `nft -f` runs the three as one transaction, so there
 * is no instant at which the table is missing.
 */
const table = ({ family, body }: { family: NftablesFamily; body: readonly string[] }) => [
  `table ${family} ${NFTABLES_TABLE}`,
  `delete table ${family} ${NFTABLES_TABLE}`,
  '',
  `table ${family} ${NFTABLES_TABLE} {`,
  ...body,
  '}',
];

/**
 * Rendered whole and applied with `nft -f`, so the rules are a function of state rather than a
 * history of edits: no incremental add can be missed and a rerun converges.
 */
export function renderRuleset(state: FirewallState): string {
  return `${[
    ...table({
      family: 'ip',
      body: [
        ...counterObjects(state),
        ...forwardChainV4(state),
        '',
        ...inputChainV4(),
        '',
        ...natChainsV4(state),
        '',
        ...trafficChainsV4(state),
      ],
    }),
    '',
    ...table({
      family: 'ip6',
      body: [...forwardChainV6(state), '', ...inputChainV6()],
    }),
  ].join('\n')}\n`;
}

/**
 * Counts, and decides nothing: every rule here is a bare `counter` with no verdict, so traffic
 * passes through exactly as it would if the chains were absent.
 *
 * Two chains because there are two ways in and they meet different hooks. The proxy dials the
 * loopback port, which is locally generated and reaches `output`; anything from off the box —
 * which is how a public port an app asked for is served — is forwarded and reaches `forward`.
 * One counter behind both is what makes "is anybody using this app" a single number rather than
 * a sum somebody could forget to take.
 *
 * A loopback source is what makes the output chain only the proxy's traffic. The nat output hook
 * has already rewritten the destination by the time this runs, and the postrouting snat that
 * re-sources it onto the tap has not, so a packet from the proxy is still 127.0.0.1 here. The
 * agent's own health probes dial the guest address directly and are sourced from the tap, so they
 * are not counted — being kept awake by the probing of the process deciding to sleep it is the
 * one way this measurement could be circular.
 *
 * The forward chain sits after the isolation rules rather than beside them: those end in a
 * verdict, so what reaches this has already been allowed, and nothing rejected is counted as use.
 */
function trafficChainsV4({ instances }: FirewallState): string[] {
  if (instances.length === 0) {
    return [];
  }
  return [
    ...chain({
      header: 'traffic_output {',
      rules: [
        'type filter hook output priority filter; policy accept;',
        ...instances.map(
          (instance) =>
            `ip saddr 127.0.0.0/8 ip daddr ${instance.guestIpv4} tcp dport ${instance.httpPort} counter name ${appCounterName(instance.appId)}`,
        ),
      ],
    }),
    '',
    ...chain({
      header: 'traffic_forward {',
      rules: [
        `type filter hook forward priority ${TRAFFIC_CHAIN_PRIORITY}; policy accept;`,
        ...instances.map(
          (instance) =>
            `iifname != ${TAP_MATCH} oifname ${TAP_MATCH} ip daddr ${instance.guestIpv4} counter name ${appCounterName(instance.appId)}`,
        ),
      ],
    }),
  ];
}

function forwardChainV4({ controlPlaneCidrsV4 }: FirewallState): string[] {
  return chain({
    header: 'forward {',
    rules: [
      'type filter hook forward priority filter; policy accept;',
      'ct state established,related accept',
      `iifname ${TAP_MATCH} ip daddr ${INSTANCE_METADATA_ADDRESS_V4} ${DENY} comment "instance metadata endpoint"`,
      `iifname ${TAP_MATCH} oifname ${TAP_MATCH} ${DENY} comment "guest to guest"`,
      `iifname ${TAP_MATCH} ip daddr ${GUEST_NETWORK_CIDR} ${DENY} comment "guest to guest"`,
      ...controlPlaneCidrsV4.map(
        (cidr) => `iifname ${TAP_MATCH} ip daddr ${cidr} ${DENY} comment "control plane"`,
      ),
      `iifname ${TAP_MATCH} ip daddr ${set(PRIVATE_DESTINATIONS_V4)} ${DENY} comment "private destinations"`,
    ],
  });
}

/** Guest traffic to the host's own tap address never reaches the forward hook. */
function inputChainV4(): string[] {
  return chain({
    header: 'input {',
    rules: [
      'type filter hook input priority filter; policy accept;',
      `iifname ${TAP_MATCH} ct state established,related accept`,
      `iifname ${TAP_MATCH} ${DENY} comment "guest to host"`,
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
      `iifname ${TAP_MATCH} ip6 daddr ${INSTANCE_METADATA_ADDRESS_V6} ${DENY} comment "instance metadata endpoint"`,
      `iifname ${TAP_MATCH} oifname ${TAP_MATCH} ${DENY} comment "guest to guest"`,
      ...controlPlaneCidrsV6.map(
        (cidr) => `iifname ${TAP_MATCH} ip6 daddr ${cidr} ${DENY} comment "control plane"`,
      ),
      `iifname ${TAP_MATCH} ip6 daddr ${set(PRIVATE_DESTINATIONS_V6)} ${DENY} comment "private destinations"`,
    ],
  });
}

function inputChainV6(): string[] {
  return chain({
    header: 'input {',
    rules: [
      'type filter hook input priority filter; policy accept;',
      `iifname ${TAP_MATCH} ct state established,related accept`,
      `iifname ${TAP_MATCH} ${DENY} comment "guest to host"`,
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
            `iifname != ${TAP_MATCH} tcp dport ${instance.hostPort} dnat to ${instance.guestIpv4}:${instance.httpPort}`,
        ),
        // The same port on both sides, and both protocols: what arrives here has already been
        // forwarded once without being renumbered, and rewriting it now would leave a binary
        // announcing a port nothing reaches. Which protocol a tenant wants is not nibrun's to know.
        ...instances.flatMap((instance) =>
          instance.extraPublicPort === undefined
            ? []
            : (['tcp', 'udp'] as const).map(
                (protocol) =>
                  `iifname != ${TAP_MATCH} ${protocol} dport ${instance.extraPublicPort} dnat to ${instance.guestIpv4}:${instance.extraPublicPort}`,
              ),
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
            `ip daddr 127.0.0.1 tcp dport ${instance.hostPort} dnat to ${instance.guestIpv4}:${instance.httpPort}`,
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
