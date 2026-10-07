import { describe, expect, test } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import { SqliteOperationSchema, SqliteOutcomeSchema } from '#control/sqlite-query.ts';

describe('SQLite relay contracts', () => {
  test('relays complete Hrana pipelines and results without resolving statements', () => {
    const body = { baton: null, requests: [{ type: 'execute', stmt: { sql_id: 1 } }] };
    const result = { baton: 'next', base_url: null, results: [] };
    expect(Value.Check(SqliteOperationSchema, { type: 'pipeline', body })).toBe(true);
    expect(Value.Check(SqliteOutcomeSchema, { status: 'pipelined', result })).toBe(true);
    expect(
      Value.Check(SqliteOperationSchema, { type: 'execute', statement: { sql: 'SELECT 1' } }),
    ).toBe(false);
    expect(
      Value.Check(SqliteOperationSchema, {
        type: 'pipeline',
        body: { requests: [{ type: 'unknown' }] },
      }),
    ).toBe(false);
  });
});
