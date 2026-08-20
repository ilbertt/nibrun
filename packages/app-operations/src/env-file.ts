import { InvalidEnvironmentError } from '#errors.ts';

/** A variable a file sets, and the text it sets it to. A file never removes one. */
export type EnvironmentAssignment = { name: string; value: string };

const COMMENT = '#';
const EXPORT = 'export ';
const ASSIGNMENT = '=';
const ESCAPE = '\\';
const QUOTES = new Set(['"', "'"]);
const DOUBLE_QUOTE = '"';
const INLINE_COMMENT = /\s#/;

const ESCAPED: Record<string, string> = {
  n: '\n',
  r: '\r',
  t: '\t',
  '\\': '\\',
  '"': '"',
};

/**
 * A `.env` file as the variables it sets, taking it for what such a file already is everywhere
 * else: blank lines and `#` comments are skipped, `export` in front of a name is allowed, a value
 * may be quoted, and a quoted one may run over several lines.
 *
 * A line that is none of those is refused rather than skipped. Someone who picked a file on
 * purpose is better told which line could not be read than left with variables quietly missing
 * from what they thought they had loaded.
 */
export function parseEnvFile(text: string): EnvironmentAssignment[] {
  const lines = text.split(/\r?\n/);
  const entries: EnvironmentAssignment[] = [];

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    index++;

    if (trimmed === '' || trimmed.startsWith(COMMENT)) {
      continue;
    }

    const assignment = trimmed.startsWith(EXPORT) ? trimmed.slice(EXPORT.length) : trimmed;
    const at = assignment.indexOf(ASSIGNMENT);
    if (at <= 0) {
      throw new InvalidEnvironmentError(`Line ${index} of the file is not NAME=value: ${trimmed}`);
    }

    // Read off the line as it was written rather than off the trimmed copy, so that whatever a
    // quoted value holds at either end is what was quoted.
    const name = assignment.slice(0, at).trim();
    const written = line.slice(line.indexOf(ASSIGNMENT) + 1).trimStart();
    const quote = written[0];

    if (quote === undefined || !QUOTES.has(quote)) {
      entries.push({ name, value: unquoted(written) });
      continue;
    }

    const quoted = gather({ lines, from: index, opened: written.slice(1), quote, name });
    entries.push({ name, value: quoted.value });
    index = quoted.index;
  }

  return entries;
}

/**
 * A quoted value, however many lines it takes to close it. Only double quotes carry escapes, as
 * they do in a shell: inside single quotes a backslash is a backslash, and a path that ends in
 * one would otherwise swallow the quote that closes it.
 */
function gather({
  lines,
  from,
  opened,
  quote,
  name,
}: {
  lines: readonly string[];
  from: number;
  opened: string;
  quote: string;
  name: string;
}): { value: string; index: number } {
  const escapes = quote === DOUBLE_QUOTE;
  let body = opened;
  let index = from;

  while (closesAt({ body, quote, escapes }) === -1) {
    if (index >= lines.length) {
      throw new InvalidEnvironmentError(`A value opened with ${quote} is never closed: ${name}`);
    }
    body += `\n${lines[index]}`;
    index++;
  }

  const closed = body.slice(0, closesAt({ body, quote, escapes }));
  return { value: escapes ? unescaped(closed) : closed, index };
}

function closesAt({
  body,
  quote,
  escapes,
}: {
  body: string;
  quote: string;
  escapes: boolean;
}): number {
  for (let at = 0; at < body.length; at++) {
    if (escapes && body[at] === ESCAPE) {
      at++;
      continue;
    }
    if (body[at] === quote) {
      return at;
    }
  }
  return -1;
}

function unescaped(value: string): string {
  let plain = '';
  for (let at = 0; at < value.length; at++) {
    const character = value[at] ?? '';
    const next = value[at + 1];
    if (character === ESCAPE && next !== undefined && next in ESCAPED) {
      plain += ESCAPED[next];
      at++;
      continue;
    }
    plain += character;
  }
  return plain;
}

// What follows a `#` after whitespace is a comment, as it is in the files this reads: a value
// that has to hold one says so by being quoted.
function unquoted(written: string): string {
  const at = written.search(INLINE_COMMENT);
  return (at === -1 ? written : written.slice(0, at)).trim();
}
