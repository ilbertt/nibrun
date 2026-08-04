import { stdoutOf } from '#lib/exec.ts';
import { type FirewallState, renderRuleset } from '#network/firewall.ts';

export const applyRuleset = (state: FirewallState) =>
  stdoutOf({ command: ['nft', '-f', '-'], stdin: renderRuleset(state) });
