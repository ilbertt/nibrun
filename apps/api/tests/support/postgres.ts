import { SQL } from 'bun';

export const UNIQUE_VIOLATION = '23505';
export const MALFORMED_IDENTIFIER = '22P02';

// Bun keeps its own name on `code` and the SQLSTATE on `errno`, so a helper reading `code`
// would match nothing.
export function postgresError({
  sqlstate,
  constraint,
}: {
  sqlstate: string;
  constraint?: string;
}): SQL.PostgresError {
  return new SQL.PostgresError('postgres said no', {
    code: 'ERR_POSTGRES_SERVER_ERROR',
    errno: sqlstate,
    ...(constraint && { constraint }),
  });
}

export function uniqueViolation(constraint: string): SQL.PostgresError {
  return postgresError({ sqlstate: UNIQUE_VIOLATION, constraint });
}
