import { SQL } from 'bun';

// Bun keeps its own `ERR_POSTGRES_*` name on `code` and puts the SQLSTATE on `errno`.
const UNIQUE_VIOLATION = '23505';
const INVALID_TEXT_REPRESENTATION = '22P02';

// Postgres raises 22P02 for every type that cannot read the text it was handed, and names the
// function that failed. This is the one that parses a uuid; `array_in` and the rest are ours.
const UUID_PARSE_ROUTINE = 'string_to_uuid';

/**
 * Narrowed to one named constraint on purpose: a caller that retries on any unique violation
 * would also retry the ones that mean the request itself is wrong, forever.
 */
export function isUniqueViolation({
  error,
  constraint,
}: {
  error: unknown;
  constraint: string;
}): boolean {
  return (
    error instanceof SQL.PostgresError &&
    error.errno === UNIQUE_VIOLATION &&
    error.constraint === constraint
  );
}

/**
 * An identifier the wire schema admits but a uuid column cannot hold.
 *
 * `identifierSchema` bounds ids to a short token, not to a uuid, so a path parameter like
 * `app-1` is valid on the wire and reaches Postgres as one. No such value can name a row, so
 * this is the request being wrong rather than the server.
 *
 * The routine is checked and not just the SQLSTATE, because everything Postgres cannot parse
 * shares it — a value this end failed to encode included. Answering 400 to one of those tells a
 * caller their request was wrong about something only the server could have got wrong.
 */
export function isMalformedIdentifier(error: unknown): boolean {
  return (
    error instanceof SQL.PostgresError &&
    error.errno === INVALID_TEXT_REPRESENTATION &&
    error.routine === UUID_PARSE_ROUTINE
  );
}
