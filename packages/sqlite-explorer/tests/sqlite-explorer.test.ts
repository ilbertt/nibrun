import { describe, expect, test } from 'bun:test';
import { tableQuery, validateSqliteQuery } from '#lib/query.ts';
import { displaySqliteValue } from '#lib/values.ts';

const CONNECTION_URL = 'https://app.nibrun.com/api/sqlite/connections/test/';
const SQLITE_MAX_INTEGER = 9223372036854775807n;
const SAFE_INTEGER = 42;
const FRACTIONAL_OFFSET = 0.5;
const MAX_BYTE = 255;
const SQL = 'SELECT * FROM users';

function query(url: string) {
  return { url, authToken: ' test-token ', sql: SQL, offset: 0, table: undefined };
}

describe('SQLite explorer', () => {
  test('preserves the connection path and trims the token', () => {
    expect(validateSqliteQuery(query(CONNECTION_URL))).toEqual({
      url: CONNECTION_URL,
      authToken: 'test-token',
      sql: SQL,
      offset: 0,
      table: undefined,
    });
  });

  test('accepts libsql URLs using HTTPS transport', () => {
    expect(validateSqliteQuery(query('libsql://sample.turso.io')).url).toBe(
      'https://sample.turso.io/',
    );
  });

  test('accepts local HTTP servers for development', () => {
    expect(validateSqliteQuery(query('http://127.0.0.1:4984/')).url).toBe('http://127.0.0.1:4984/');
  });

  test.each([
    'file:/tmp/test.db',
    'https://user:secret@sample.turso.io',
    'https://sample.turso.io?token=secret',
  ])('rejects unsupported connection URL %s', (url) => {
    expect(() => validateSqliteQuery(query(url))).toThrow();
  });

  test('rejects empty queries before creating a database client', () => {
    expect(() => validateSqliteQuery({ ...query(CONNECTION_URL), sql: '' })).toThrow();
  });

  test.each([-1, FRACTIONAL_OFFSET, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid pagination offset %s',
    (offset) => {
      expect(() => validateSqliteQuery({ ...query(CONNECTION_URL), offset })).toThrow();
    },
  );

  test.each([
    "INSERT INTO users (name) VALUES ('Ada')",
    'WITH selected AS (SELECT 1) UPDATE users SET id = 2',
    'PRAGMA table_info(users)',
    'SELECT FROM users',
    '  SELECT * FROM users;  ',
  ])('leaves SQL validation to the database: %s', (sql) => {
    expect(validateSqliteQuery({ ...query(CONNECTION_URL), sql }).sql).toBe(sql);
  });

  test('accepts queries without pagination', () => {
    expect(
      validateSqliteQuery({ ...query(CONNECTION_URL), offset: undefined }).offset,
    ).toBeUndefined();
  });

  test('quotes table names without changing their meaning', () => {
    expect(tableQuery('a"b')).toBe('SELECT * FROM "a""b"');
  });

  test('preserves SQLite integers beyond JavaScript precision', () => {
    expect(displaySqliteValue(SQLITE_MAX_INTEGER)).toBe('9223372036854775807');
    expect(displaySqliteValue(BigInt(SAFE_INTEGER))).toBe(SAFE_INTEGER);
  });

  test('renders blobs losslessly, including empty blobs', () => {
    expect(displaySqliteValue(new Uint8Array([0, MAX_BYTE, 1]).buffer)).toBe('0x00ff01');
    expect(displaySqliteValue(new ArrayBuffer(0))).toBe('0x');
  });
});
