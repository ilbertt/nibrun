import type { TenantArguments } from '@repo/protocol';
import { UsageError } from '#lib/errors.ts';

const WHITESPACE = /\s/;
const ESCAPE = '\\';
const SINGLE = "'";
const DOUBLE = '"';

export type CommandLine = {
  // A path on this machine or a url the api fetches; what it is, is decided where it is opened.
  binarySource: string;
  args: TenantArguments;
};

/**
 * Read `nib run`'s one positional as the command line it is: a binary, then whatever that binary
 * is to be started with.
 *
 * One argument rather than a trailing list, because a bare list cannot be told apart from this
 * program's own flags — `--verbose` after the path is either the tenant's or ours, and nothing
 * about where it sits answers that. Quoting is what answers it, and quoting is the shell's
 * existing way of saying "this is one value".
 */
export function parseCommandLine(line: string): CommandLine {
  const [binarySource, ...args] = tokenize(line);
  if (binarySource === undefined) {
    throw new UsageError('Name the binary to run.');
  }
  return { binarySource, args };
}

/**
 * The same line without a binary in front of it, which is what `--args` carries. Quoted as one
 * value for the same reason the positional is: a bare list cannot be told apart from this
 * program's own flags.
 */
export function parseArguments(line: string): TenantArguments {
  return tokenize(line);
}

function separates({ char, quote }: { char: string; quote: string | null }): boolean {
  return quote === null && WHITESPACE.test(char);
}

function opensQuote({ char, quote }: { char: string; quote: string | null }): boolean {
  return quote === null && (char === SINGLE || char === DOUBLE);
}

/**
 * The character a backslash stands for, or `undefined` where it is only itself — as it is inside
 * single quotes, where nothing is special, which is what makes them the way to hand a Windows
 * path or a regex through untouched.
 */
function escapedAt({
  line,
  index,
  quote,
}: {
  line: string;
  index: number;
  quote: string | null;
}): string | undefined {
  return line[index] === ESCAPE && quote !== SINGLE ? line[index + 1] : undefined;
}

/** `''` between two quotes is a token; never having started one is not. */
function ended(token: string | null): string[] {
  return token === null ? [] : [token];
}

/**
 * The shell's own rules, applied a second time to the string the shell handed over whole. Only
 * the part that separates arguments: nothing here expands a variable, a glob or a `$(…)`, so a
 * tenant argument that contains one arrives at the guest exactly as written.
 */
function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let token: string | null = null;
  let quote: string | null = null;

  for (let index = 0; index < line.length; index++) {
    const char = line[index]!;

    if (separates({ char, quote })) {
      tokens.push(...ended(token));
      token = null;
      continue;
    }

    token ??= '';

    if (char === quote) {
      quote = null;
      continue;
    }
    if (opensQuote({ char, quote })) {
      quote = char;
      continue;
    }

    const escaped = escapedAt({ line, index, quote });
    if (escaped !== undefined) {
      token += escaped;
      index++;
      continue;
    }
    token += char;
  }

  if (quote !== null) {
    throw new UsageError(`Unbalanced ${quote} in the command line.`);
  }
  tokens.push(...ended(token));
  return tokens;
}
