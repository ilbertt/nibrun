import { describe, expect, test } from 'bun:test';
import {
  AppIdSchema,
  HostPortSchema,
  HttpPortSchema,
  Ipv4AddressSchema,
  Value,
} from '@repo/protocol';
import {
  appCounterName,
  type FirewallState,
  INSTANCE_METADATA_ADDRESS_V4,
  INSTANCE_METADATA_ADDRESS_V6,
  NFTABLES_TABLE,
  renderRuleset,
} from '#lib/network/firewall.ts';

// The ranges the blanket v6 rule covers, to assert that a VPC's range is not among them.
const PRIVATE_DESTINATIONS_V6_SAMPLE = ['::1', 'fe80:', 'fc', 'fd'];

const HOST_PORT_NUMBER = 21_000;
const HTTP_PORT_NUMBER = 3000;
const EXTRA_PUBLIC_PORT_NUMBER = 22_000;

const APP_ID = '0198f3aa-1c2d-7e4b-9f11-a0b1c2d3e4f5';

const instance = {
  appId: Value.Parse(AppIdSchema, APP_ID),
  hostPort: Value.Parse(HostPortSchema, HOST_PORT_NUMBER),
  httpPort: Value.Parse(HttpPortSchema, HTTP_PORT_NUMBER),
  hostIpv4: Value.Parse(Ipv4AddressSchema, '10.201.0.1'),
  guestIpv4: Value.Parse(Ipv4AddressSchema, '10.201.0.2'),
};

const askedForAPort = {
  ...instance,
  extraPublicPort: Value.Parse(HostPortSchema, EXTRA_PUBLIC_PORT_NUMBER),
};

function state(overrides: Partial<FirewallState> = {}): FirewallState {
  return {
    instances: [],
    controlPlaneCidrsV4: [],
    controlPlaneCidrsV6: [],
    ...overrides,
  };
}

function refusalsFrom(ruleset: string) {
  return ruleset
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes(' reject'));
}

describe('the three isolation rules are never optional', () => {
  test('guests cannot reach the instance metadata endpoint, with no instances configured', () => {
    const refusals = refusalsFrom(renderRuleset(state()));
    expect(refusals.some((line) => line.includes(INSTANCE_METADATA_ADDRESS_V4))).toBe(true);
  });

  test('guests cannot reach each other', () => {
    const refusals = refusalsFrom(renderRuleset(state({ instances: [instance] })));
    expect(refusals.some((line) => line.includes('guest to guest'))).toBe(true);
    expect(refusals.some((line) => line.includes('10.201.0.0/16'))).toBe(true);
  });

  test('guests cannot reach the control plane', () => {
    const ruleset = renderRuleset(state({ controlPlaneCidrsV4: ['203.0.113.10/32'] }));
    expect(refusalsFrom(ruleset).some((line) => line.includes('203.0.113.10/32'))).toBe(true);
  });

  // The api's internal routes are reachable from this host and from nowhere else, so a tenant
  // that could reach them would be reaching them with the host's standing. Denied before the
  // forwarding rule that gives guests the internet, or the accept would win.
  test('a guest cannot reach the control plane before it is allowed out', () => {
    const vpc = '10.43.0.0/16';
    const lines = renderRuleset(state({ controlPlaneCidrsV4: [vpc] })).split('\n');
    const denied = lines.findIndex((line) => line.includes(vpc) && line.includes('reject'));
    const allowedOut = lines.findIndex((line) => line.includes('masquerade'));

    expect(denied).toBeGreaterThan(-1);
    expect(allowedOut).toBeGreaterThan(denied);
  });

  test('every private destination is denied, not only the ones enumerated', () => {
    const refusals = refusalsFrom(renderRuleset(state())).join('\n');
    for (const cidr of ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16']) {
      expect(refusals).toContain(cidr);
    }
  });

  test('guests cannot reach services on the host itself', () => {
    expect(
      refusalsFrom(renderRuleset(state())).some((line) => line.includes('guest to host')),
    ).toBe(true);
  });

  // A tenant hitting a denied address gets an error its socket reports at once, rather than a
  // silence it spends its own timeout on and logs nothing about. One `drop` anywhere in either
  // table is one denial that reaches an app as an unexplained stall.
  test('nothing is denied silently, in either family', () => {
    const ruleset = renderRuleset(
      state({
        instances: [instance],
        controlPlaneCidrsV4: ['10.43.0.0/16'],
        controlPlaneCidrsV6: ['2600:1f18:abcd::/56'],
      }),
    );

    expect(ruleset).not.toContain('drop');
  });
});

// `table ip` cannot see v6 at all, and a tap carries a link-local v6 address from the moment it
// is created — so without a second table every isolation rule above is one family wide.
describe('the same isolation holds over ipv6', () => {
  test('guests cannot reach the host over its link-local address', () => {
    const v6 = renderRuleset(state()).split(`table ip6 ${NFTABLES_TABLE} {`)[1] ?? '';
    expect(v6).toContain('guest to host');
    expect(v6).toContain('fe80::/10');
  });

  test('guests cannot reach each other or the metadata endpoint over v6', () => {
    const v6 = renderRuleset(state()).split(`table ip6 ${NFTABLES_TABLE} {`)[1] ?? '';
    expect(v6).toContain('guest to guest');
    expect(v6).toContain(INSTANCE_METADATA_ADDRESS_V6);
  });

  // Blocking v6 outright would have been the smaller change and the wrong one: public v6 is
  // egress a tenant is entitled to, exactly as public v4 is.
  test('public v6 is not blocked, only the internal ranges', () => {
    const v6 = renderRuleset(state()).split(`table ip6 ${NFTABLES_TABLE} {`)[1] ?? '';
    expect(v6).toContain('::1/128');
    expect(v6).toContain('fc00::/7');
    expect(v6).not.toContain('::/0');
  });

  test('the v6 table is rebuilt from state like the v4 one', () => {
    const ruleset = renderRuleset(state());
    expect(ruleset).toContain(`table ip6 ${NFTABLES_TABLE}\ndelete table ip6 ${NFTABLES_TABLE}\n`);
  });

  // AWS allocates a VPC's IPv6 from global unicast, so `fc00::/7` does not contain it. Where the
  // v4 control-plane rule is belt-and-braces over the blanket private refusal, this one is the only
  // thing denying the control plane — a v6 ruleset without it reads it as ordinary internet.
  test('the vpc v6 range is denied by name, since no blanket rule contains it', () => {
    const vpcV6 = '2600:1f18:abcd::/56';
    const v6 = renderRuleset(state({ controlPlaneCidrsV6: [vpcV6] })).split(
      `table ip6 ${NFTABLES_TABLE} {`,
    )[1];

    expect(v6).toContain(`ip6 daddr ${vpcV6} reject`);
    // Named, rather than swept up by a private-range rule that does not cover it.
    expect(PRIVATE_DESTINATIONS_V6_SAMPLE.some((range) => vpcV6.startsWith(range))).toBe(false);
  });

  test('the v6 control-plane denial lands before anything lets a guest out', () => {
    const vpcV6 = '2600:1f18:abcd::/56';
    const lines = renderRuleset(state({ controlPlaneCidrsV6: [vpcV6] }))
      .split(`table ip6 ${NFTABLES_TABLE} {`)[1]
      ?.split('\n')
      .map((line) => line.trim());
    const denied = lines?.findIndex((line) => line.includes(vpcV6));
    const blanket = lines?.findIndex((line) => line.includes('private destinations'));

    expect(denied).toBeGreaterThan(-1);
    expect(blanket).toBeGreaterThan(denied ?? -1);
  });
});

describe('forwarding', () => {
  test('a host port is forwarded to the HTTP port, not to itself', () => {
    const ruleset = renderRuleset(state({ instances: [instance] }));
    expect(ruleset).toMatch(/tcp dport 21000 .*dnat to 10\.201\.0\.2:3000/);
  });

  test('nothing is forwarded when nothing is running', () => {
    expect(renderRuleset(state())).not.toContain('dnat to');
  });

  test('guest egress is masqueraded, but only when leaving the guest network', () => {
    expect(renderRuleset(state())).toContain('ip saddr 10.201.0.0/16 oifname != "nbr*" masquerade');
  });

  // nft accepts `dstnat` only on prerouting and rejects the whole ruleset otherwise, which
  // leaves the host with no isolation rules at all rather than with one bad chain.
  test('the output chain uses a priority nft accepts on that hook', () => {
    const ruleset = renderRuleset(state({ instances: [instance] }));
    const output = ruleset.split('\n').find((line) => line.includes('hook output'));

    expect(output).toContain('priority -100');
    expect(ruleset).not.toContain('hook output priority dstnat');
  });

  test('host-local traffic to a forwarded port is re-sourced so the guest can reply', () => {
    const ruleset = renderRuleset(state({ instances: [instance] }));
    expect(ruleset).toContain('ip saddr 127.0.0.0/8 ip daddr 10.201.0.2 snat to 10.201.0.1');
  });
});

// The port a tenant asked for, which is the one case where the number may not change: a binary
// announcing the port it bound is announcing this one, so a rewrite here is a port nothing reaches.
describe('the port an app asked for arrives as the port it was sent to', () => {
  test('both protocols reach the guest on the same number', () => {
    const ruleset = renderRuleset(state({ instances: [askedForAPort] }));
    expect(ruleset).toMatch(/tcp dport 22000 .*dnat to 10\.201\.0\.2:22000/);
    expect(ruleset).toMatch(/udp dport 22000 .*dnat to 10\.201\.0\.2:22000/);
  });

  test('an app that asked for none is given none', () => {
    const ruleset = renderRuleset(state({ instances: [instance] }));
    expect(ruleset).not.toContain('22000');
    expect(ruleset).not.toContain('udp dport');
  });

  // The rule is what a packet from the internet meets; a guest reaching the host's own tap address
  // on that port would otherwise be forwarded to whichever guest holds it.
  test('the rule does not answer traffic coming from a guest', () => {
    const rules = renderRuleset(state({ instances: [askedForAPort] }))
      .split('\n')
      .filter((line) => line.includes('dport 22000'));

    expect(rules).toHaveLength(2);
    expect(rules.every((line) => line.trim().startsWith('iifname != "nbr*"'))).toBe(true);
  });
});

describe('the ruleset is a function of state, not a history of edits', () => {
  test('the table is deleted and rebuilt, so a rerun converges instead of accumulating', () => {
    const ruleset = renderRuleset(state({ instances: [instance] }));
    expect(
      ruleset.startsWith(`table ip ${NFTABLES_TABLE}\ndelete table ip ${NFTABLES_TABLE}\n`),
    ).toBe(true);
  });

  test('rendering twice from the same state is byte-identical', () => {
    const input = state({ instances: [instance], controlPlaneCidrsV4: ['203.0.113.0/24'] });
    expect(renderRuleset(input)).toBe(renderRuleset(input));
  });
});

describe('an app is counted wherever it is reached', () => {
  const linesOf = ({ ruleset, match }: { ruleset: string; match: string }) =>
    ruleset
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.includes(match));

  test('every forwarded app declares a counter of its own', () => {
    const ruleset = renderRuleset(state({ instances: [instance] }));
    expect(ruleset).toContain(`counter ${appCounterName(instance.appId)} {`);
  });

  test('the name is bare, because nft rejects a quoted one where a declaration names itself', () => {
    const ruleset = renderRuleset(state({ instances: [instance] }));
    expect(ruleset).not.toContain(`counter "${appCounterName(instance.appId)}"`);
  });

  // The reason this file has a test about where a counter is *not*: a nat hook is traversed for
  // the packet that opens a connection and no other, so counting there counts connections. An app
  // read over a pooled connection would go quiet while it was being used, and quiet is what puts
  // a microVM down underneath somebody.
  test('no rule that forwards to a guest carries a counter', () => {
    const ruleset = renderRuleset(state({ instances: [instance, askedForAPort] }));
    for (const rule of linesOf({ ruleset, match: 'dnat to' })) {
      expect(rule).not.toContain('counter');
    }
  });

  test('the proxy reaching a guest over loopback is counted', () => {
    const rules = linesOf({
      ruleset: renderRuleset(state({ instances: [instance] })),
      match: 'ip saddr 127.0.0.0/8',
    });
    const counted = rules.filter((rule) => rule.includes('counter name'));
    expect(counted).toHaveLength(1);
    expect(counted[0]).toContain(`ip daddr ${instance.guestIpv4}`);
    expect(counted[0]).toContain(appCounterName(instance.appId));
  });

  test('traffic arriving from off the box is counted against the same app', () => {
    const ruleset = renderRuleset(state({ instances: [instance] }));
    const forwarded = linesOf({ ruleset, match: 'oifname "nbr*" ip daddr' }).filter((rule) =>
      rule.includes('counter name'),
    );
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]).toContain(appCounterName(instance.appId));
  });

  test('both ways in name one counter, so nothing has to be summed to answer for an app', () => {
    const counted = linesOf({
      ruleset: renderRuleset(state({ instances: [instance] })),
      match: 'counter name',
    });
    expect(counted).toHaveLength(2);
    for (const rule of counted) {
      expect(rule).toContain(appCounterName(instance.appId));
    }
  });

  // A guest is reachable on a port it asked for without that port being in any rule here: the
  // forward rule matches the address, so a protocol nobody thought about is counted anyway.
  test('a port an app asked for needs no counting rule of its own', () => {
    const withPort = linesOf({
      ruleset: renderRuleset(state({ instances: [askedForAPort] })),
      match: 'counter name',
    });
    const without = linesOf({
      ruleset: renderRuleset(state({ instances: [instance] })),
      match: 'counter name',
    });
    expect(withPort).toHaveLength(without.length);
  });

  test('counting runs after the rules that refuse, so nothing rejected reads as use', () => {
    const ruleset = renderRuleset(state({ instances: [instance] }));
    expect(ruleset).toContain('type filter hook forward priority filter + 10;');
  });

  test('a host with no apps declares no counters and adds no chains', () => {
    const ruleset = renderRuleset(state());
    expect(ruleset).not.toContain('counter ');
    expect(ruleset).not.toContain('traffic_');
  });
});
