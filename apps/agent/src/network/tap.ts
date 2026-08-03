import type { Ipv4Address } from '@repo/protocol';
import { type CommandRunner, runCommandOrThrow } from '#lib/exec.ts';
import { TAP_NAME_PREFIX } from '#network/allocator.ts';

const IP_COMMAND = 'ip';
const SYSCTL_COMMAND = 'sysctl';

export function parseLinkNames(output: string): string[] {
  const parsed: unknown = JSON.parse(output);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .map((entry) => (entry as { ifname?: unknown }).ifname)
    .filter((name): name is string => typeof name === 'string');
}

export const isTapName = (name: string) =>
  name.startsWith(TAP_NAME_PREFIX) && /^\d+$/.test(name.slice(TAP_NAME_PREFIX.length));

export async function listTapNames({ runner }: { runner: CommandRunner }): Promise<string[]> {
  const output = await runCommandOrThrow({
    runner,
    request: { command: [IP_COMMAND, '-json', 'link', 'show'] },
  });
  return parseLinkNames(output).filter(isTapName);
}

export type TapInterface = {
  tapName: string;
  hostIpv4: Ipv4Address;
  subnetPrefixLength: number;
};

export async function ensureTap({
  runner,
  tap,
}: {
  runner: CommandRunner;
  tap: TapInterface;
}): Promise<void> {
  const existing = await listTapNames({ runner });
  if (!existing.includes(tap.tapName)) {
    await runCommandOrThrow({
      runner,
      request: { command: [IP_COMMAND, 'tuntap', 'add', 'dev', tap.tapName, 'mode', 'tap'] },
    });
  }
  // Idempotent by outcome rather than by command: `addr replace` leaves a re-run of a
  // converged host doing nothing, which is what lets reconcile call this unconditionally.
  await runCommandOrThrow({
    runner,
    request: {
      command: [
        IP_COMMAND,
        'addr',
        'replace',
        `${tap.hostIpv4}/${tap.subnetPrefixLength}`,
        'dev',
        tap.tapName,
      ],
    },
  });
  await runCommandOrThrow({
    runner,
    request: { command: [IP_COMMAND, 'link', 'set', 'dev', tap.tapName, 'up'] },
  });
  // The kernel treats 127.0.0.0/8 as martian on any interface but loopback, so without this it
  // drops the reply to a connection opened against the forwarded 127.0.0.1 port before the
  // nftables SNAT can rewrite it. The local proxy reaches every app that way, so a tap without
  // it is a tap nothing can route to.
  await runCommandOrThrow({
    runner,
    request: {
      command: [SYSCTL_COMMAND, '-w', `net.ipv4.conf.${tap.tapName}.route_localnet=1`],
    },
  });
}

export async function removeTap({
  runner,
  tapName,
}: {
  runner: CommandRunner;
  tapName: string;
}): Promise<void> {
  await runner({ command: [IP_COMMAND, 'link', 'del', 'dev', tapName] });
}
