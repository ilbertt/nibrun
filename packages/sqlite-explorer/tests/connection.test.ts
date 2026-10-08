import { describe, expect, test } from 'bun:test';
import { validateSqliteConnection } from '#lib/connection.ts';
import { displaySqliteValue } from '#lib/values.ts';

const SQLITE_MAX_INTEGER = 9223372036854775807n;
const SAFE_INTEGER = 42;
const MAX_BYTE = 255;
const CONNECTION_URL = 'https://app.nibrun.com/api/sqlite/connections/test/';

describe('SQLite connection', () => {
  test('preserves the API connection path and trims credentials', () => {
    expect(validateSqliteConnection({ url: CONNECTION_URL, authToken: ' token ' })).toEqual({
      url: CONNECTION_URL,
      authToken: 'token',
    });
  });
  test('maps libsql URLs onto HTTPS', () => {
    expect(validateSqliteConnection({ url: 'libsql://sample.turso.io', authToken: '' }).url).toBe(
      'https://sample.turso.io/',
    );
  });
  test.each([
    'file:/tmp/test.db',
    'https://user:secret@sample.turso.io',
    'https://sample.turso.io?token=secret',
  ])('rejects unsupported connection %s', (url) => {
    expect(() => validateSqliteConnection({ url, authToken: '' })).toThrow();
  });
  test('preserves large integers, binary and text values', () => {
    expect(displaySqliteValue(SQLITE_MAX_INTEGER)).toBe('9223372036854775807');
    expect(displaySqliteValue(BigInt(SAFE_INTEGER))).toBe(SAFE_INTEGER);
    expect(displaySqliteValue(new Uint8Array([0, MAX_BYTE, 1]).buffer)).toBe('0x00ff01');
    expect(displaySqliteValue('a\0b')).toBe('a\0b');
    expect(displaySqliteValue(null)).toBeNull();
  });
});
