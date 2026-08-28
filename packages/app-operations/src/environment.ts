import {
  namesOfferedRuntimeValues,
  RUNTIME_VALUE_NAMES,
  type TenantEnvironmentPatch,
  TenantEnvironmentPatchSchema,
  Value,
} from '@repo/protocol';
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
  // Checked before it is parsed, never by parsing: a name the schema does not allow is no part of
  // the record, so parsing drops it and then succeeds — which reads as a variable accepted and
  // then silently not set.
  const refused = edits
    .map(({ name }) => name)
    .filter((name) => !Value.Check(TenantEnvironmentPatchSchema, { [name]: null }));
  if (refused.length > 0) {
    throw new InvalidEnvironmentError(
      `An environment variable's name must start with a letter or underscore, hold only letters, digits and underscores, and not be __proto__: ${refused.join(', ')}`,
    );
  }

  // The guest is what substitutes these, and a name it does not offer fails the boot rather than
  // reaching the binary as itself — so a typo is answered here, before anything is deployed over
  // it. The variable is named and its value never is: it is the tenant's secret either way.
  const naming = edits
    .filter(({ value }) => value !== null && !namesOfferedRuntimeValues(value))
    .map(({ name }) => name);
  if (naming.length > 0) {
    throw new InvalidEnvironmentError(
      `A value may name a runtime value the guest sets — ${RUNTIME_VALUE_NAMES.map(written).join(', ')} — and nothing else: ${naming.join(', ')}`,
    );
  }

  return Value.Parse(
    TenantEnvironmentPatchSchema,
    Object.fromEntries(edits.map(({ name, value }) => [name, value])),
  );
}

/** A runtime value as it is named in a tenant value, which is the form worth showing back. */
function written(name: string): string {
  return `\${${name}}`;
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
