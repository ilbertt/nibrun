import { describe, expect, test } from 'bun:test';
import { hranaDescribeResult, hranaStatementResult } from '#lib/hrana/results.ts';
import { hranaStatement, resolveHranaSql } from '#lib/hrana/sql.ts';

describe('Hrana SQL translation', () => {
  test('normalizes missing arguments and resolves stored SQL', () => {
    const SQL_ID = -7;
    expect(
      hranaStatement({ statement: { sql_id: SQL_ID }, storedSql: new Map([[SQL_ID, 'SELECT 1']]) }),
    ).toEqual({
      sql: 'SELECT 1',
      args: [],
      namedArgs: [],
      wantRows: true,
    });
  });

  test('requires exactly one SQL source and a known stored id', () => {
    for (const reference of [{}, { sql: 'SELECT 1', sql_id: 0 }, { sql_id: 0 }]) {
      expect(() => {
        resolveHranaSql({ reference, storedSql: new Map() });
      }).toThrow();
    }
  });

  test('keeps large integers and blobs intact while restoring external null fields', () => {
    const rows = [
      [
        { type: 'integer' as const, value: '9223372036854775807' },
        { type: 'blob' as const, base64: 'AA==' },
      ],
    ];
    expect(
      hranaStatementResult({
        columns: [{ name: 'large' }, { name: 'bytes', declaredType: 'BLOB' }],
        rows,
        affectedRowCount: 0,
      }),
    ).toEqual({
      cols: [
        { name: 'large', decltype: null },
        { name: 'bytes', decltype: 'BLOB' },
      ],
      rows,
      affected_row_count: 0,
      last_insert_rowid: null,
    });
    expect(
      hranaDescribeResult({
        parameters: [{}],
        columns: [{ name: 'value' }],
        isExplain: false,
        isReadonly: true,
      }),
    ).toEqual({
      params: [{ name: null }],
      cols: [{ name: 'value', decltype: null }],
      is_explain: false,
      is_readonly: true,
    });
  });
});
