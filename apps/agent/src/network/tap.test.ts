import { describe, expect, test } from 'bun:test';
import type { Ipv4Address } from '@repo/protocol';
import type { CommandRequest } from '#lib/exec.ts';
import { ensureTap } from '#network/tap.ts';

const tap = {
  tapName: 'nbr7',
  hostIpv4: '10.201.0.29' as Ipv4Address,
  subnetPrefixLength: 30,
};

function recordingRunner() {
  const commands: string[][] = [];
  const runner = (request: CommandRequest) => {
    commands.push([...request.command]);
    // The only command whose output is read back; every tap must look absent so
    // ensureTap takes the create path.
    return Promise.resolve({
      code: 0,
      stdout: request.command.includes('-json') ? '[]' : '',
      stderr: '',
    });
  };
  return { commands, runner };
}

describe('a tap is usable the moment it is up', () => {
  test('the proxy can route to it, because 127.0.0.0/8 is not martian on it', async () => {
    const { commands, runner } = recordingRunner();
    await ensureTap({ runner, tap });

    expect(commands).toContainEqual([
      'sysctl',
      '-w',
      `net.ipv4.conf.${tap.tapName}.route_localnet=1`,
    ]);
  });

  // The kernel drops the packet before nftables can rewrite it, so an interface
  // brought up without this answers nothing and looks like a dead tenant.
  test('it is set on the interface rather than left to a global default', async () => {
    const { commands, runner } = recordingRunner();
    await ensureTap({ runner, tap });

    const sysctl = commands.find(([command]) => command === 'sysctl')?.join(' ');
    expect(sysctl).toContain(tap.tapName);
    expect(sysctl).not.toContain('conf.all');
  });
});
