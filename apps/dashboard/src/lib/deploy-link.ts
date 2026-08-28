import type { ConfigEdit, EnvironmentAssignment } from '@repo/app-operations';

const ASSIGNMENT = '=';

/**
 * What a "Deploy on nibrun" link may ask for, as the parameter that carries each part of a deploy
 * and the way that parameter is read. Keyed by `ConfigEdit`, so anything a release grows the
 * ability to configure is a link that stops compiling until it can be written into one.
 *
 * Every one of these only prefills a field the owner can still edit, and the api validates what is
 * submitted, so an absurd value costs a correction rather than a refusal here.
 */
const CONFIGURED = {
  // A number because the router parses search values as JSON and writes them back the same way:
  // held as a string, `?port=3000` would be rewritten to `?port="3000"` in the address bar of
  // everyone who followed the link.
  port: { param: 'port', read: asPort },
  extraPublicPort: { param: 'extra-public-port', read: asFlag },
  args: { param: 'arg', read: asArguments },
  environment: { param: 'env', read: asAssignments },
} as const satisfies {
  [K in keyof Required<ConfigEdit>]: { param: string; read: (value: unknown) => unknown };
};

type Configured = {
  [K in keyof typeof CONFIGURED]?: ReturnType<(typeof CONFIGURED)[K]['read']>;
};

/** What a link asked for, before the owner has touched anything. */
export type DeploySuggestion = Configured & { name?: string | undefined };

export function deploySuggestion(search: Record<string, unknown>): DeploySuggestion {
  return { name: asText(search.name), ...configured(search) };
}

// `Object.fromEntries` cannot carry which reader answered for which key, and the record above is
// what says so — the same keys, read in the same order, with what each reader returns.
function configured(search: Record<string, unknown>): Configured {
  return Object.fromEntries(
    Object.entries(CONFIGURED).map(([key, { param, read }]) => [key, read(search[param])]),
  ) as Configured;
}

// A value reaches here already taken for what it looks like: `?port=3000` is a number and
// `?extra-public-port=true` a boolean before anything below sees them, so text is what is left of
// one rather than what it arrives as.
function asText(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : undefined;
}

function asPort(value: unknown): number | undefined {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : undefined;
}

// A parameter written without a value is how a flag is asked for everywhere else, and the only
// thing `?extra-public-port` on its own could mean.
function asFlag(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  return value === '' ? true : undefined;
}

function asArguments(value: unknown): string[] | undefined {
  const args = written(value);
  return args.length === 0 ? undefined : args;
}

function asAssignments(value: unknown): EnvironmentAssignment[] | undefined {
  // A name given twice takes its last value, as the same words would in a shell.
  const named = new Map(written(value).map(assigned));
  return named.size === 0
    ? undefined
    : [...named].map(([name, assignedValue]) => ({ name, value: assignedValue }));
}

/**
 * A variable the link asks for, and the value it brought. A bare `?env=API_KEY` brings none: a
 * link is read by whoever wrote it and by everyone who follows it, which makes it the wrong place
 * for a secret and the right place to say which ones the app needs.
 */
function assigned(entry: string): [string, string] {
  const at = entry.indexOf(ASSIGNMENT);
  return at < 0 ? [entry.trim(), ''] : [entry.slice(0, at).trim(), entry.slice(at + 1)];
}

/** What was written under a parameter: the router hands over one occurrence, or an array of them. */
function written(value: unknown): string[] {
  const occurrences = Array.isArray(value) ? value : [value];
  return occurrences.flatMap((occurrence) => {
    const text = asText(occurrence);
    return text === undefined || text.length === 0 ? [] : [text];
  });
}
