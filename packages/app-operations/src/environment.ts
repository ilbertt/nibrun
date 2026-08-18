import { type TenantEnvironment, TenantEnvironmentSchema, Value } from '@repo/protocol';
import { InvalidEnvironmentError } from '#errors.ts';

const ASSIGNMENT = '=';

/**
 * `NAME=value` per entry, split at the first `=` only: a value is arbitrary text and secrets
 * routinely hold one, so anything after the first belongs to what was set rather than separating
 * it. A name given twice takes its last value, as the same words would in a shell.
 */
export function parseEnvironment(assignments: readonly string[]): TenantEnvironment {
  const entries = assignments.map((assignment) => {
    const at = assignment.indexOf(ASSIGNMENT);
    if (at <= 0) {
      throw new InvalidEnvironmentError(
        `An environment variable is given as NAME=value, and this has no name: ${assignment}`,
      );
    }
    return [assignment.slice(0, at).trim(), assignment.slice(at + 1)] as const;
  });

  // Checked before it is parsed, never by parsing: a name the schema does not allow is no part of
  // the record, so parsing drops it and then succeeds — which reads as a variable accepted and
  // then silently not set.
  const refused = entries
    .map(([name]) => name)
    .filter((name) => !Value.Check(TenantEnvironmentSchema, { [name]: '' }));
  if (refused.length > 0) {
    throw new InvalidEnvironmentError(
      `An environment variable's name must start with a letter or underscore and hold only letters, digits and underscores: ${refused.join(', ')}`,
    );
  }

  return Value.Parse(TenantEnvironmentSchema, Object.fromEntries(entries));
}
