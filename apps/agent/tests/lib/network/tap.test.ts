import { describe, expect, test } from 'bun:test';
import { Ipv4AddressSchema, Value } from '@repo/protocol';
import { Effect } from 'effect';
import type { CommandRequest } from '#lib/exec.ts';
import { ensureTap } from '#lib/network/tap.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';

const tap = {
  tapName: 'nbr7',
  hostIpv4: Value.Parse(Ipv4AddressSchema, '10.201.0.29'),
  subnetPrefixLength: 30,
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
