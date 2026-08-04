import { describe, expect, test } from 'bun:test';
import type { GuestPort, HostPort, Ipv4Address } from '@repo/protocol';
import {
  type FirewallState,
  INSTANCE_METADATA_ADDRESS_V4,
  INSTANCE_METADATA_ADDRESS_V6,
  NFTABLES_TABLE,
  renderRuleset,
} from '#network/firewall.ts';

const DNS_PORT = 53;

// The ranges the blanket v6 rule covers, to assert that a VPC's range is not among them.
const PRIVATE_DESTINATIONS_V6_SAMPLE = ['::1', 'fe80:', 'fc', 'fd'];

const instance = {
  hostPort: 21_000 as HostPort,
  guestPort: 3000 as GuestPort,
  hostIpv4: '10.201.0.1' as Ipv4Address,
  guestIpv4: '10.201.0.2' as Ipv4Address,
};

function state(overrides: Partial<FirewallState> = {}): FirewallState {
  return {
    instances: [],
    controlPlaneCidrsV4: [],
    controlPlaneCidrsV6: [],
    guestDnsServers: [],
    ...overrides,
  };
}

const dropsFrom = (ruleset: string) =>
  ruleset
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('drop') || line.includes('drop comment'));

describe('the three isolation rules are never optional', () => {
  test('guests cannot reach the instance metadata endpoint, with no instances configured', () => {
    const drops = dropsFrom(renderRuleset(state()));
    expect(drops.some((line) => line.includes(INSTANCE_METADATA_ADDRESS_V4))).toBe(true);
  });

  test('guests cannot reach each other', () => {
    const drops = dropsFrom(renderRuleset(state({ instances: [instance] })));
    expect(drops.some((line) => line.includes('guest to guest'))).toBe(true);
    expect(drops.some((line) => line.includes('10.201.0.0/16'))).toBe(true);
  });

  test('guests cannot reach the control plane', () => {
    const ruleset = renderRuleset(state({ controlPlaneCidrsV4: ['203.0.113.10/32'] }));
    expect(dropsFrom(ruleset).some((line) => line.includes('203.0.113.10/32'))).toBe(true);
  });

  // The api's internal routes are reachable from this host and from nowhere else, so a tenant
  // that could reach them would be reaching them with the host's standing. Denied before the
  // forwarding rule that gives guests the internet, or the accept would win.
  test('a guest cannot reach the control plane before it is allowed out', () => {
    const vpc = '10.43.0.0/16';
    const lines = renderRuleset(state({ controlPlaneCidrsV4: [vpc] })).split('\n');
    const denied = lines.findIndex((line) => line.includes(vpc) && line.includes('drop'));
    const allowedOut = lines.findIndex((line) => line.includes('masquerade'));

    expect(denied).toBeGreaterThan(-1);
    expect(allowedOut).toBeGreaterThan(denied);
  });

  test('every private destination is denied, not only the ones enumerated', () => {
    const drops = dropsFrom(renderRuleset(state())).join('\n');
    for (const cidr of ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16']) {
      expect(drops).toContain(cidr);
    }
  });

  test('guests cannot reach services on the host itself', () => {
    expect(dropsFrom(renderRuleset(state())).some((line) => line.includes('guest to host'))).toBe(
      true,
    );
  });

  // A resolver accepted by address alone opens every port on it. Harmless for a VPC resolver,
  // and a hole in the guest-to-host drop the moment the address given is one of the host's own.
  test('a named resolver is reachable on port 53 and not on everything else', () => {
    const input = renderRuleset(state({ guestDnsServers: ['10.0.0.2'] }))
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.includes('10.0.0.2') && line.endsWith('accept'));

    expect(input.length).toBeGreaterThan(0);
    for (const rule of input) {
      expect(rule).toContain(`dport ${DNS_PORT}`);
    }
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
  // v4 control-plane rule is belt-and-braces over the blanket private drop, this one is the only
  // thing denying the control plane — a v6 ruleset without it reads it as ordinary internet.
  test('the vpc v6 range is denied by name, since no blanket rule contains it', () => {
    const vpcV6 = '2600:1f18:abcd::/56';
    const v6 = renderRuleset(state({ controlPlaneCidrsV6: [vpcV6] })).split(
      `table ip6 ${NFTABLES_TABLE} {`,
    )[1];

    expect(v6).toContain(`ip6 daddr ${vpcV6} drop`);
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
  test('a host port is forwarded to the guest port, not to itself', () => {
    const ruleset = renderRuleset(state({ instances: [instance] }));
    expect(ruleset).toContain('tcp dport 21000 dnat to 10.201.0.2:3000');
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

  test('a named DNS resolver is allowed out before the blanket private drop', () => {
    const ruleset = renderRuleset(state({ guestDnsServers: ['10.0.0.2'] }));
    const lines = ruleset.split('\n').map((line) => line.trim());
    const accept = lines.findIndex((line) => line.startsWith('iifname "nbr*" ip daddr 10.0.0.2'));
    const drop = lines.findIndex((line) => line.includes('private destinations'));
    expect(accept).toBeGreaterThan(-1);
    expect(accept).toBeLessThan(drop);
  });
});
