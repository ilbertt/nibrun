import { describe, expect, test } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import { SqliteOperationSchema, SqliteOutcomeSchema } from '#control/sqlite-query.ts';

describe('SQLite relay contracts', () => {
  test('shares Hrana results with the relay while requiring resolved guest statements', () => {
    const result = {
      cols: [{ name: 'value', decltype: null }],
      rows: [],
      affected_row_count: 0,
      last_insert_rowid: null,
    };
    expect(Value.Check(SqliteOutcomeSchema, { status: 'executed', result })).toBe(true);
    expect(
      Value.Check(SqliteOperationSchema, {
        type: 'execute',
        statement: {
          sql: 'SELECT 1',
          args: [],
          named_args: [],
          want_rows: true,
        },
      }),
    ).toBe(true);
    expect(Value.Check(SqliteOperationSchema, { type: 'execute', statement: { sql_id: 1 } })).toBe(
      false,
    );
  });
});
