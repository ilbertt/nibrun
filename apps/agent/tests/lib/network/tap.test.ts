import { describe, expect, test } from 'bun:test';
import { Ipv4AddressSchema, Value } from '@repo/protocol';
import { Effect } from 'effect';
import type { CommandRequest } from '#lib/exec.ts';
import { ensureTap, refreshNeighbour } from '#lib/network/tap.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';

const tap = {
  tapName: 'nbr7',
  hostIpv4: Value.Parse(Ipv4AddressSchema, '10.201.0.29'),
  subnetPrefixLength: 30,
};

const guest = {
  guestIpv4: Value.Parse(Ipv4AddressSchema, '10.201.0.30'),
  guestMac: '02:00:0a:c9:00:1e',
  tapName: tap.tapName,
};

// The only command whose output is read back; every tap looks absent so the create path is taken.
function noTapsExist({ command }: CommandRequest) {
  return succeeding({ stdout: command.includes('-json') ? '[]' : '' });
}

async function issuedCommands() {
  const { commands, layer } = recordingCommands(noTapsExist);
  await Effect.runPromise(Effect.provide(ensureTap(tap), layer));
  return commands.map(({ command }) => [...command]);
}

describe('a tap is usable the moment it is up', () => {
  test('the proxy can route to it, because 127.0.0.0/8 is not martian on it', async () => {
    expect(await issuedCommands()).toContainEqual([
      'sysctl',
      '-w',
      `net.ipv4.conf.${tap.tapName}.route_localnet=1`,
    ]);
  });

  // The kernel drops the packet before nftables can rewrite it, so an interface brought up
  // without this answers nothing and looks like a dead tenant.
  test('it is set on the interface rather than left to a global default', async () => {
    const sysctl = (await issuedCommands()).find(([command]) => command === 'sysctl')?.join(' ');
    expect(sysctl).toContain(tap.tapName);
    expect(sysctl).not.toContain('conf.all');
  });
});

async function neighbourCommand() {
  const { commands, layer } = recordingCommands();
  await Effect.runPromise(Effect.provide(refreshNeighbour(guest), layer));
  return commands.map(({ command }) => [...command]).at(0);
}

/**
 * Both a cold boot and a wake write this entry, and neither has anything to notice its absence
 * by: an unprimed host resolves the address by ARP and the app comes up a second later, which
 * reads as a slow tenant rather than as a command that did nothing.
 */
describe('the host knows where a guest is before it asks', () => {
  test('the pairing is written against the tap the guest is behind', async () => {
    expect(await neighbourCommand()).toEqual([
      'ip',
      'neigh',
      'replace',
      guest.guestIpv4,
      'lladdr',
      guest.guestMac,
      'dev',
      guest.tapName,
      'nud',
      'reachable',
    ]);
  });

  // `replace` rather than `add`, because a boot onto a slot that has held a guest before finds
  // the entry already there — and `add` fails on one that exists, which would leave the stale
  // pairing in place on exactly the hosts that have been up longest.
  test('an entry already there is overwritten rather than refused', async () => {
    expect(await neighbourCommand()).toContain('replace');
  });
});
