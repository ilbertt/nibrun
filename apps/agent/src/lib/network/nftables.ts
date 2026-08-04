import { type FirewallState, renderRuleset } from '#lib/network/firewall.ts';
import { stdoutOf } from '#services/command-runner.service.ts';

export const applyRuleset = (state: FirewallState) =>
  stdoutOf({ command: ['nft', '-f', '-'], stdin: renderRuleset(state) });
