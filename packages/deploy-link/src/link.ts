import type { ConfigEdit, EnvironmentAssignment } from '@repo/app-operations';
import { refusedUrl } from '#binary-url.ts';

const ASSIGNMENT = '=';

type Carried = { param: string; read: (value: unknown) => unknown };

/**
 * Each part of a deploy a link may ask for, as the parameter that carries it and the way that
 * parameter is read. Keyed by `ConfigEdit`, so anything a release grows the ability to configure
 * is a link that stops compiling until it can carry it.
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
  args: { param: 'arg', read: asWritten },
  environment: { param: 'env', read: asWritten },
} as const satisfies { [K in keyof Required<ConfigEdit>]: Carried };

type Written = {
  [K in keyof typeof CONFIGURED as (typeof CONFIGURED)[K]['param']]?: ReturnType<
    (typeof CONFIGURED)[K]['read']
  >;
};

/**
 * A link as it is written, one property per parameter. The router rebuilds the address bar out of
 * this every time the page navigates — following the ghost button out of the minimal form is one —
 * so a property named anything but the parameter it was read from would be written back beside it,
 * as a second copy nothing here reads.
 */
export type DeployLink = Written & {
  name?: string | undefined;
  binary?: string | undefined;
  sha256?: string | undefined;
  minimal?: boolean | undefined;
};

export function deployLink(search: Record<string, unknown>): DeployLink {
  return {
    name: asText(search.name),
    binary: asBinaryUrl(search.binary),
    sha256: asChecksum(search.sha256),
    minimal: asFlag(search.minimal),
    ...written(search),
  };
}

// Refused rather than prefilled: a url this end can already say is wrong is one the owner would
// otherwise send, wait for, and be told about by the api.
function asBinaryUrl(value: unknown): string | undefined {
  const url = asText(value);
  return url !== undefined && refusedUrl(url) === undefined ? url : undefined;
}

/**
 * The one parameter carried however it was written rather than dropped where it is wrong: what
 * this end drops is a deploy that goes ahead unverified, which is the single outcome a checksum
 * exists to rule out. Whatever it turns out to be, the form refuses it by name.
 *
 * Lowercased because a digest is one number however it was printed, and the api takes it in the
 * spelling `sha256sum` writes.
 */
function asChecksum(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const written = String(value).trim().toLowerCase();
  return written === '' ? undefined : written;
}

// Read off the parameters rather than the keys: `Object.fromEntries` cannot carry which reader
// answered for which, and it is the parameter each is written under that both halves agree on.
function written(search: Record<string, unknown>): Written {
  return Object.fromEntries(
    Object.values(CONFIGURED).map(({ param, read }) => [param, read(search[param])]),
  ) as Written;
}

type Meant = {
  port: number;
  extraPublicPort: boolean;
  args: string[];
  environment: EnvironmentAssignment[];
};

/** What a link asked for, before the owner has touched anything. */
export type DeploySuggestion = { [K in keyof typeof CONFIGURED]?: Meant[K] } & {
  name?: string | undefined;
  // Not part of what a deploy configures — it is what is being deployed. A link carrying one is
  // the difference between a form with one thing left to do and a form with none.
  binary?: string | undefined;
  // What that binary should hash to, for the api to hold the bytes it fetches to. Never shown:
  // there is nothing to decide about it, and the owner is not the one who wrote it down.
  sha256?: string | undefined;
};

/** The link as the deploy it describes. A parameter renamed above is a line here that stops compiling. */
export function deploySuggestion(link: DeployLink): DeploySuggestion {
  return {
    name: link.name,
    binary: link.binary,
    sha256: link.sha256,
    port: link.port,
    extraPublicPort: link['extra-public-port'],
    args: link.arg,
    environment: link.env && assignments(link.env),
  };
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

/** What was written under a parameter: the router hands over one occurrence, or an array of them. */
function asWritten(value: unknown): string[] | undefined {
  const occurrences = Array.isArray(value) ? value : [value];
  const written = occurrences.flatMap((occurrence) => {
    const text = asText(occurrence);
    return text === undefined || text.length === 0 ? [] : [text];
  });
  return written.length === 0 ? undefined : written;
}

function assignments(written: readonly string[]): EnvironmentAssignment[] {
  // A name given twice takes its last value, as the same words would in a shell.
  const named = new Map(written.map(assigned));
  return [...named].map(([name, value]) => ({ name, value }));
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
