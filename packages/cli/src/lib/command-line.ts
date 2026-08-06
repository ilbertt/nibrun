import type { TenantArguments } from '@repo/protocol';
import { UsageError } from '#lib/errors.ts';

const WHITESPACE = /\s/;
const ESCAPE = '\\';
const SINGLE = "'";
const DOUBLE = '"';

export type CommandLine = {
  binaryPath: string;
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
  const [binaryPath, ...args] = tokenize(line);
  if (binaryPath === undefined) {
    throw new UsageError('Name the binary to run.');
  }
  return { binaryPath, args };
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

    if (quote === null && WHITESPACE.test(char)) {
      if (token !== null) {
        tokens.push(token);
        token = null;
      }
      continue;
    }

    token ??= '';

    if (char === quote) {
      quote = null;
      continue;
    }
    if (quote === null && (char === SINGLE || char === DOUBLE)) {
      quote = char;
      continue;
    }
    // Literal inside single quotes, where nothing is special — which is what makes them the way
    // to hand a Windows path or a regex through untouched.
    const escaped = line[index + 1];
    if (char === ESCAPE && quote !== SINGLE && escaped !== undefined) {
      token += escaped;
      index++;
      continue;
    }
    token += char;
  }

  if (quote !== null) {
    throw new UsageError(`Unbalanced ${quote} in the command line.`);
  }
  if (token !== null) {
    tokens.push(token);
  }
  return tokens;
}
