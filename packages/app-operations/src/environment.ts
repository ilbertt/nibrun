import type { TenantEnvironmentPatch } from '@repo/api-client/models';
import { InvalidEnvironmentError } from '#errors.ts';

const ASSIGNMENT = '=';

/** A variable and what is to become of it: the text it is set to, or `null` to remove it. */
export type EnvironmentEdit = { name: string; value: string | null };

/**
 * What a command line said about an app's environment: `NAME=value` for each variable it sets and
 * a bare name for each it removes.
 *
 * An assignment is split at the first `=` only: a value is arbitrary text and secrets routinely
 * hold one, so anything after the first belongs to what was set rather than separating it. A name
 * given twice takes its last value, as the same words would in a shell.
 */
export function parseEnvironment({
  set,
  remove,
}: {
  set: readonly string[];
  remove: readonly string[];
}): TenantEnvironmentPatch {
  return parseEnvironmentPatch([
    ...set.map(assigned),
    ...remove.map((name) => ({ name: name.trim(), value: null })),
  ]);
}

/**
 * The same edits from a caller that already holds the two halves apart — a form with a field for
 * each — so that what a name may be is answered in one place whatever it was typed into.
 */
export function parseEnvironmentPatch(edits: readonly EnvironmentEdit[]): TenantEnvironmentPatch {
  const refused = edits.filter(
    ({ name }) => name === '__proto__' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name),
  );
  if (refused.length > 0) {
    throw new InvalidEnvironmentError(
      `An environment variable’s name must start with a letter or underscore, hold only letters, digits and underscores, and not be __proto__: ${refused.map(({ name }) => name).join(', ')}`,
    );
  }
  return Object.fromEntries(edits.map(({ name, value }) => [name, value]));
}

function assigned(assignment: string): EnvironmentEdit {
  const at = assignment.indexOf(ASSIGNMENT);
  if (at <= 0) {
    throw new InvalidEnvironmentError(
      `An environment variable is given as NAME=value, and this has no name: ${assignment}`,
    );
  }
  return { name: assignment.slice(0, at).trim(), value: assignment.slice(at + 1) };
}
