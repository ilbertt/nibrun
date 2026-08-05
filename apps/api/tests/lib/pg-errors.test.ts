import { describe, expect, test } from 'bun:test';
import { isMalformedIdentifier, isUniqueViolation } from '#lib/pg-errors.ts';
import { MALFORMED_IDENTIFIER, postgresError, uniqueViolation } from '#tests/support/postgres.ts';

describe('a malformed identifier is the request being wrong, not the server', () => {
  test('a uuid column refusing a wire-valid id is recognised', () => {
    expect(isMalformedIdentifier(postgresError({ sqlstate: MALFORMED_IDENTIFIER }))).toBe(true);
  });

  test('nothing else is', () => {
    expect(isMalformedIdentifier(uniqueViolation('apps_slug_key'))).toBe(false);
    expect(isMalformedIdentifier(new Error('connection terminated'))).toBe(false);
  });
});

describe('a unique violation is only the constraint it names', () => {
  test('the named constraint matches', () => {
    const error = uniqueViolation('apps_slug_key');

    expect(isUniqueViolation({ error, constraint: 'apps_slug_key' })).toBe(true);
  });

  // Retrying on any unique violation would spend every attempt on one the request itself caused.
  test('another constraint does not', () => {
    const error = uniqueViolation('some_other_key');

    expect(isUniqueViolation({ error, constraint: 'apps_slug_key' })).toBe(false);
  });
});
