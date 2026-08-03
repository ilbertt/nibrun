import { type CommandRunner, runCommandOrThrow } from '#lib/exec.ts';
import { type FirewallState, renderRuleset } from '#network/firewall.ts';

const NFT_COMMAND = 'nft';

export async function applyRuleset({
  runner,
  state,
}: {
  runner: CommandRunner;
  state: FirewallState;
}): Promise<string> {
  const ruleset = renderRuleset(state);
  await runCommandOrThrow({
    runner,
    request: { command: [NFT_COMMAND, '-f', '-'], stdin: ruleset },
  });
  return ruleset;
}
