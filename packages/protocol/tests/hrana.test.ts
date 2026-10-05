import { describe, expect, test } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import {
  HranaPipelineReqBodySchema,
  HranaStmtResultSchema,
  HranaValueSchema,
} from '#domain/hrana.ts';
import { HranaValueSchema as UpstreamValueSchema } from '#domain/hrana-v2.gen.ts';
import { SQLITE_MAX_PARAMETERS, SQLITE_MAX_VALUE_LENGTH } from '#domain/sqlite.ts';

describe('bounded upstream Hrana schemas', () => {
  test('keeps the wire representation lossless through JSON', () => {
    const result = {
      cols: [{ name: null, decltype: null }],
      rows: [
        [
          { type: 'integer', value: '9223372036854775807' },
          { type: 'blob', base64: 'AP8=' },
        ],
      ],
      affected_row_count: 0,
      last_insert_rowid: null,
    };
    expect(Value.Check(HranaStmtResultSchema, JSON.parse(JSON.stringify(result)))).toBe(true);
  });

  test('adds value limits without mutating upstream schemas', () => {
    const oversized = { type: 'text', value: 'x'.repeat(SQLITE_MAX_VALUE_LENGTH + 1) };
    expect(Value.Check(UpstreamValueSchema, oversized)).toBe(true);
    expect(Value.Check(HranaValueSchema, oversized)).toBe(false);
    expect(Value.Check(HranaValueSchema, { type: 'integer', value: '1.5' })).toBe(false);
    expect(Value.Check(HranaValueSchema, { type: 'blob', base64: '!' })).toBe(false);
  });

  test('accepts omitted batons and nullable SQL references while bounding parameters', () => {
    const stmt = { sql: null, sql_id: -1, args: [] };
    expect(Value.Check(HranaPipelineReqBodySchema, { requests: [{ type: 'execute', stmt }] })).toBe(
      true,
    );
    expect(
      Value.Check(HranaPipelineReqBodySchema, {
        requests: [
          {
            type: 'execute',
            stmt: {
              sql: 'SELECT ?',
              args: Array.from({ length: SQLITE_MAX_PARAMETERS + 1 }, function value() {
                return { type: 'null' };
              }),
            },
          },
        ],
      }),
    ).toBe(false);
  });

  test('rejects non-integer steps and overlong batons inside nullable unions', () => {
    const NON_INTEGER_STEP = 0.5;
    expect(
      Value.Check(HranaPipelineReqBodySchema, {
        requests: [
          {
            type: 'batch',
            batch: {
              steps: [
                { condition: { type: 'ok', step: NON_INTEGER_STEP }, stmt: { sql: 'SELECT 1' } },
              ],
            },
          },
        ],
      }),
    ).toBe(false);
    const OVERLONG_BATON = 129;
    expect(
      Value.Check(HranaPipelineReqBodySchema, { baton: 'x'.repeat(OVERLONG_BATON), requests: [] }),
    ).toBe(false);
  });
});
