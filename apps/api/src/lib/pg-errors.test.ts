import { describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { isMalformedIdentifier, isUniqueViolation } from '#lib/pg-errors.ts';

// Bun keeps its own name on `code` and the SQLSTATE on `errno`, so a helper reading `code`
// would match nothing.
function postgresError({ sqlstate, constraint }: { sqlstate: string; constraint?: string }) {
  return new SQL.PostgresError('postgres said no', {
    code: 'ERR_POSTGRES_SERVER_ERROR',
    errno: sqlstate,
    ...(constraint && { constraint }),
  });
}

describe('a malformed identifier is the request being wrong, not the server', () => {
  test('a uuid column refusing a wire-valid id is recognised', () => {
    expect(isMalformedIdentifier(postgresError({ sqlstate: '22P02' }))).toBe(true);
  });

  test('nothing else is', () => {
    expect(isMalformedIdentifier(postgresError({ sqlstate: '23505' }))).toBe(false);
    expect(isMalformedIdentifier(new Error('connection terminated'))).toBe(false);
  });
});

describe('a unique violation is only the constraint it names', () => {
  test('the named constraint matches', () => {
    const error = postgresError({ sqlstate: '23505', constraint: 'apps_slug_key' });

    expect(isUniqueViolation({ error, constraint: 'apps_slug_key' })).toBe(true);
  });

  // Retrying on any unique violation would spend every attempt on one the request itself caused.
  test('another constraint does not', () => {
    const error = postgresError({ sqlstate: '23505', constraint: 'some_other_key' });

    expect(isUniqueViolation({ error, constraint: 'apps_slug_key' })).toBe(false);
  });
});
