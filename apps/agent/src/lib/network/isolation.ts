import { Data, Effect } from 'effect';
import { parseKernelRuleset } from '#lib/network/tables.ts';

export class FirewallVerificationFailed extends Data.TaggedError('FirewallVerificationFailed') {
  override get message() {
    return 'The installed tenant isolation rules could not be verified.';
  }
}

export function requireRuleset(output: string) {
  const ruleset = parseKernelRuleset(output);
  return ruleset === undefined
    ? Effect.fail(new FirewallVerificationFailed())
    : Effect.succeed(ruleset);
}
