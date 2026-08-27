import { Effect, Option, Ref } from 'effect';
import { type FirewallState, renderRuleset } from '#lib/network/firewall.ts';
import { stdoutOf } from '#services/command-runner.service.ts';

/**
 * The kernel's copy of `renderRuleset`, and the memory of what was last put there. Which tenants
 * are forwarded changes on the probe rather than on desired state, so this is applied on every
 * status tick — and an unchanged ruleset has to cost nothing rather than a table replacement a
 * second.
 */
export class HostFirewall extends Effect.Service<HostFirewall>()('HostFirewall', {
  effect: Effect.gen(function* () {
    // Never applied by this process yet, so the first apply always runs: what is in the kernel
    // came from whichever agent ran before, and the host may have changed since.
    const applied = yield* Ref.make(Option.none<string>());

    return {
      apply: Effect.fn('HostFirewall.apply')(function* (state: FirewallState) {
        const ruleset = renderRuleset(state);
        if (Option.getOrUndefined(yield* Ref.get(applied)) === ruleset) {
          return;
        }
        yield* stdoutOf({ command: ['nft', '-f', '-'], stdin: ruleset });
        yield* Ref.set(applied, Option.some(ruleset));
      }),
    };
  }),
}) {}
