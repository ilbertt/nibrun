import { describe, expect, test } from 'bun:test';
import { hranaStatement, resolveHranaSql } from '#lib/hrana/sql.ts';

describe('Hrana SQL translation', () => {
  test('normalizes missing arguments and resolves stored SQL', () => {
    const SQL_ID = -7;
    expect(
      hranaStatement({ statement: { sql_id: SQL_ID }, storedSql: new Map([[SQL_ID, 'SELECT 1']]) }),
    ).toEqual({
      sql: 'SELECT 1',
      args: [],
      named_args: [],
      want_rows: true,
    });
  });

  test('requires exactly one SQL source and a known stored id', () => {
    for (const reference of [{}, { sql: 'SELECT 1', sql_id: 0 }, { sql_id: 0 }]) {
      expect(() => {
        resolveHranaSql({ reference, storedSql: new Map() });
      }).toThrow();
    }
  });
});
