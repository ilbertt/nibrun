import { SQL } from 'bun';

export const UNIQUE_VIOLATION = '23505';
export const MALFORMED_IDENTIFIER = '22P02';

// Bun keeps its own name on `code` and the SQLSTATE on `errno`, so a helper reading `code`
// would match nothing.
export function postgresError({
  sqlstate,
  constraint,
  routine,
}: {
  sqlstate: string;
  constraint?: string;
  routine?: string;
}): SQL.PostgresError {
  return new SQL.PostgresError('postgres said no', {
    code: 'ERR_POSTGRES_SERVER_ERROR',
    errno: sqlstate,
    ...(constraint && { constraint }),
    ...(routine && { routine }),
  });
}

// The two ways a statement reaches 22P02: a path parameter no uuid column can hold, and a value
// this end failed to encode. Only the first is the caller's doing.
export function malformedUuid(): SQL.PostgresError {
  return postgresError({ sqlstate: MALFORMED_IDENTIFIER, routine: 'string_to_uuid' });
}

export function malformedArrayLiteral(): SQL.PostgresError {
  return postgresError({ sqlstate: MALFORMED_IDENTIFIER, routine: 'array_in' });
}

export function uniqueViolation(constraint: string): SQL.PostgresError {
  return postgresError({ sqlstate: UNIQUE_VIOLATION, constraint });
}
