import { describe, expect, test } from 'bun:test';
import type { GuestPort, HostPort, Ipv4Address } from '@repo/protocol';
import {
  type FirewallState,
  INSTANCE_METADATA_ADDRESS,
  NFTABLES_TABLE,
  renderRuleset,
} from '#network/firewall.ts';

const instance = {
  hostPort: 21_000 as HostPort,
  guestPort: 3000 as GuestPort,
  hostIpv4: '10.201.0.1' as Ipv4Address,
  guestIpv4: '10.201.0.2' as Ipv4Address,
};

const state = (overrides: Partial<FirewallState> = {}): FirewallState => ({
  instances: [],
  controlPlaneCidrs: [],
  guestDnsServers: [],
  ...overrides,
});

const dropsFrom = (ruleset: string) =>
  ruleset
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('drop') || line.includes('drop comment'));

describe('the three isolation rules are never optional', () => {
  test('guests cannot reach the instance metadata endpoint, with no instances configured', () => {
    const drops = dropsFrom(renderRuleset(state()));
    expect(drops.some((line) => line.includes(INSTANCE_METADATA_ADDRESS))).toBe(true);
  });

  test('guests cannot reach each other', () => {
    const drops = dropsFrom(renderRuleset(state({ instances: [instance] })));
    expect(drops.some((line) => line.includes('guest to guest'))).toBe(true);
    expect(drops.some((line) => line.includes('10.201.0.0/16'))).toBe(true);
  });

  test('guests cannot reach the control plane', () => {
    const ruleset = renderRuleset(state({ controlPlaneCidrs: ['203.0.113.10/32'] }));
    expect(dropsFrom(ruleset).some((line) => line.includes('203.0.113.10/32'))).toBe(true);
  });

  // The api's internal routes are reachable from this host and from nowhere else, so a tenant
  // that could reach them would be reaching them with the host's standing. Denied before the
  // forwarding rule that gives guests the internet, or the accept would win.
  test('a guest cannot reach the control plane before it is allowed out', () => {
    const vpc = '10.43.0.0/16';
    const lines = renderRuleset(state({ controlPlaneCidrs: [vpc] })).split('\n');
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
    const input = state({ instances: [instance], controlPlaneCidrs: ['203.0.113.0/24'] });
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
