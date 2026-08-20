import type { EnvironmentAssignment, EnvironmentEdit } from '@repo/app-operations';
import type { AppSummary } from '#queries/apps.ts';

/**
 * A row of the environment table. `sealed` is a variable the app already runs with: the api
 * returns its name and never its value, so there is nothing to show for it and nothing this end
 * could send for it — which is exactly what leaves it as it is.
 */
export type EnvironmentVariable = {
  id: string;
  name: string;
  value: string;
  sealed: boolean;
};

/** What the app runs with now, as rows: every name it has, none of their values. */
export function storedVariables(app: AppSummary | undefined): EnvironmentVariable[] {
  return storedNames(app).map((name) => ({ id: name, name, value: '', sealed: true }));
}

// A name is what identifies a stored variable, so a fresh row cannot be keyed by one: it has no
// name until it is typed, and two of them would collide before anything could say so.
export function blankVariable(): EnvironmentVariable {
  return { id: crypto.randomUUID(), name: '', value: '', sealed: false };
}

/** A row nobody has filled in yet is not a variable, and is not sent as one. */
export function filledVariables(variables: readonly EnvironmentVariable[]): EnvironmentVariable[] {
  return variables.filter(
    (variable) => variable.sealed || variable.name.trim().length > 0 || variable.value.length > 0,
  );
}

/**
 * What the table changed, and nothing else: the values that were typed, and a `null` for every
 * variable the app has that no row does any more. A row still sealed is left out — the value
 * behind it is one this end has never seen, and saying nothing is what keeps it.
 *
 * A table nobody has touched is not an empty one. The rows are seeded from the app as the field
 * renders and only reach the form once something is edited, so no rows at all is a deploy with
 * nothing to say about the environment rather than one asking for every variable to go.
 */
export function environmentEdits({
  variables,
  stored,
}: {
  variables: readonly EnvironmentVariable[] | undefined;
  stored: readonly string[];
}): EnvironmentEdit[] {
  if (variables === undefined) {
    return [];
  }

  const rows = filledVariables(variables);
  const named = new Set(rows.map((variable) => variable.name.trim()));

  return [
    ...rows
      .filter((variable) => !variable.sealed)
      .map((variable) => ({ name: variable.name.trim(), value: variable.value })),
    ...stored.filter((name) => !named.has(name)).map((name) => ({ name, value: null })),
  ];
}

/** The names an app runs with now, which is what a row going missing is measured against. */
export function storedNames(app: AppSummary | undefined): string[] {
  return Object.keys(app?.config.environment ?? {});
}

/** The first name two rows share, which is a mistake nothing downstream could report. */
export function repeatedName(variables: readonly EnvironmentVariable[]): string | undefined {
  const seen = new Set<string>();
  for (const variable of filledVariables(variables)) {
    const name = variable.name.trim();
    if (seen.has(name)) {
      return name;
    }
    seen.add(name);
  }
  return undefined;
}

/**
 * The rows a file leaves behind: a name it sets lands on the row that already had that name, one
 * it does not is added, and a row nobody has typed into makes way. Picking a file fills the table
 * in — it does not add a variable beside a half-typed one.
 */
export function withEntries({
  variables,
  entries,
}: {
  variables: readonly EnvironmentVariable[];
  entries: readonly EnvironmentAssignment[];
}): EnvironmentVariable[] {
  const loaded = new Map(entries.map((entry) => [entry.name, entry.value]));
  const filled = filledVariables(variables).map((variable) => {
    const name = variable.name.trim();
    if (!loaded.has(name)) {
      return variable;
    }
    const value = loaded.get(name) ?? '';
    loaded.delete(name);
    return { ...variable, value, sealed: false };
  });

  return [...filled, ...[...loaded].map(([name, value]) => ({ ...blankVariable(), name, value }))];
}
