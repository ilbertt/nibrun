import { SQL } from 'bun';

// Bun keeps its own `ERR_POSTGRES_*` name on `code` and puts the SQLSTATE on `errno`.
const UNIQUE_VIOLATION = '23505';
const INVALID_TEXT_REPRESENTATION = '22P02';

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
 */
export function isMalformedIdentifier(error: unknown): boolean {
  return error instanceof SQL.PostgresError && error.errno === INVALID_TEXT_REPRESENTATION;
}
