import { Effect, Option, Ref } from 'effect';
import { parseAppTraffic } from '#lib/network/counters.ts';
import { type FirewallState, NFTABLES_TABLE, renderRuleset } from '#lib/network/firewall.ts';
import { type KernelTables, parseKernelTables } from '#lib/network/tables.ts';
import { stdoutOf } from '#services/command-runner.service.ts';

/** What was written, and the tables it was written into, which is what says it is still there. */
type Applied = {
  readonly ruleset: string;
  readonly tables: KernelTables;
};

/**
 * The kernel's copy of `renderRuleset`, and the memory of what was last put there. Which tenants
 * are forwarded changes on the probe rather than on desired state, so this is applied on every
 * status tick — and an unchanged ruleset has to cost nothing rather than a table replacement a
 * second, which would also zero the counters the activity measurement reads.
 *
 * What makes skipping safe is that the memory is never the whole answer: the kernel is asked
 * whether the tables it names are still the ones this agent created. Anything else that drops or
 * rebuilds them — an operator's `nft flush ruleset`, a service that owns the ruleset file — then
 * becomes a ruleset the next pass rewrites, rather than one this process never writes again
 * because the text it would send has not changed.
 */
export class HostFirewall extends Effect.Service<HostFirewall>()('HostFirewall', {
  effect: Effect.gen(function* () {
    // Never applied by this process yet, so the first apply always runs: what is in the kernel
    // came from whichever agent ran before, and the host may have changed since.
    const applied = yield* Ref.make(Option.none<Applied>());

    /**
     * `none` when nft could not be asked at all, which has to stay apart from a host holding no
     * tables of ours: both write the ruleset, but only the second is a state worth remembering
     * having reached.
     */
    const kernelTables = stdoutOf({ command: ['nft', '-j', 'list', 'tables'] }).pipe(
      Effect.map((json) => Option.some(parseKernelTables(json))),
      Effect.catchAll(() => Effect.succeedNone),
    );

    return {
      apply: Effect.fn('HostFirewall.apply')(function* (state: FirewallState) {
        const ruleset = renderRuleset(state);
        const last = yield* Ref.get(applied);
        if (Option.isSome(last) && last.value.ruleset === ruleset) {
          const current = yield* kernelTables;
          if (Option.isSome(current) && current.value === last.value.tables) {
            return;
          }
        }
        yield* stdoutOf({ command: ['nft', '-f', '-'], stdin: ruleset });
        // Tables that cannot be read back leave the next pass nothing to compare against, so it
        // writes them again rather than taking this pass's success as proof they are in place.
        yield* Ref.set(
          applied,
          Option.map(yield* kernelTables, (tables) => ({ ruleset, tables })),
        );
      }),

      /**
       * What the kernel has counted against each app, which is a different question from what
       * this process last wrote: the rules are ours, the counts are traffic's.
       */
      traffic: Effect.map(
        stdoutOf({ command: ['nft', '-j', 'list', 'counters', 'table', 'ip', NFTABLES_TABLE] }),
        parseAppTraffic,
      ),
    };
  }),
}) {}
