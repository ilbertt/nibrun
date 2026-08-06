import { describe, expect, test } from 'bun:test';
import { isMalformedIdentifier, isUniqueViolation } from '#lib/pg-errors.ts';
import { malformedArrayLiteral, malformedUuid, uniqueViolation } from '#tests/support/postgres.ts';

describe('a malformed identifier is the request being wrong, not the server', () => {
  test('a uuid column refusing a wire-valid id is recognised', () => {
    expect(isMalformedIdentifier(malformedUuid())).toBe(true);
  });

  // Everything Postgres cannot parse answers to 22P02, a value this end failed to encode
  // included. Calling one of those a bad request blames the caller for the server's mistake and
  // hides it behind a 400 nobody will investigate.
  test('a value this end encoded wrongly shares the sqlstate and is not one', () => {
    expect(isMalformedIdentifier(malformedArrayLiteral())).toBe(false);
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
