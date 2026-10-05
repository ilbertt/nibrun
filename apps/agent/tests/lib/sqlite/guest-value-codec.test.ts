import { describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import type { HranaValue } from '@repo/sqlite';
import { encodeSqliteValue, SqliteReplyReader } from '#lib/sqlite/guest-value-codec.ts';
import { SQLITE_INT64_MAX, sqliteField, sqliteInteger } from '#tests/support/sqlite.ts';

const BLOB_TAG = 4;
const INVALID_TAG = 42;
const MAX_BYTE = 255;

describe('Guest SQLite value codec', () => {
  test.each<HranaValue>([
    { type: 'null' },
    { type: 'integer', value: SQLITE_INT64_MAX.toString() },
    { type: 'integer', value: '-9223372036854775808' },
    { type: 'float', value: 0.125 },
    { type: 'text', value: 'héllo\0world' },
    { type: 'blob', base64: 'AP8=' },
  ])('round trips $type without JSON numeric loss', (value) => {
    const reader = new SqliteReplyReader(encodeSqliteValue(value));
    expect(reader.value()).toEqual(value);
    reader.finished();
  });

  test('uses the agreed integer and blob layouts', () => {
    expect(encodeSqliteValue({ type: 'integer', value: SQLITE_INT64_MAX.toString() })).toEqual(
      sqliteInteger(SQLITE_INT64_MAX),
    );
    expect(encodeSqliteValue({ type: 'blob', base64: 'AP8=' })).toEqual(
      Buffer.concat([Buffer.of(BLOB_TAG), sqliteField(Buffer.of(0, MAX_BYTE))]),
    );
  });

  test('decodes unnamed parameters and unknown declared types as Hrana null fields', () => {
    const count = Buffer.from([0, 0, 0, 1]);
    const reader = new SqliteReplyReader(
      Buffer.concat([
        count,
        sqliteField(''),
        count,
        sqliteField('value'),
        sqliteField(''),
        Buffer.of(1, 0),
      ]),
    );
    expect(reader.description()).toEqual({
      params: [{ name: null }],
      cols: [{ name: 'value', decltype: null }],
      is_readonly: true,
      is_explain: false,
    });
    reader.finished();
  });

  test('rejects unknown tags, short fields, invalid UTF-8, and trailing bytes', () => {
    expect(() => new SqliteReplyReader(Buffer.of(INVALID_TAG)).value()).toThrow();
    expect(() => new SqliteReplyReader(Buffer.of(1)).value()).toThrow();
    expect(() => new SqliteReplyReader(sqliteField(Buffer.of(MAX_BYTE))).text()).toThrow();
    expect(() => new SqliteReplyReader(Buffer.of(0)).finished()).toThrow();
  });
});
