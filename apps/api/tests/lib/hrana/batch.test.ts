import { describe, expect, test } from 'bun:test';
import { executeHranaBatch } from '#lib/hrana/batch.ts';
import { RecordingSqliteExecutor } from '#tests/support/hrana/executor.ts';

const signal = new AbortController().signal;

describe('Hrana batches', () => {
  test('runs conditional steps in order and distinguishes failure from skipping', async () => {
    const executor = new RecordingSqliteExecutor();
    const result = await executeHranaBatch({
      executor,
      signal,
      storedSql: new Map(),
      batch: {
        steps: [
          { stmt: { sql: 'first' } },
          { condition: { type: 'ok', step: 0 }, stmt: { sql: 'fail' } },
          { condition: { type: 'ok', step: 1 }, stmt: { sql: 'skipped' } },
          {
            condition: {
              type: 'and',
              conds: [
                { type: 'error', step: 1 },
                { type: 'not', cond: { type: 'ok', step: 2 } },
                {
                  type: 'or',
                  conds: [
                    { type: 'ok', step: 0 },
                    { type: 'error', step: 0 },
                  ],
                },
              ],
            },
            stmt: { sql: 'recovery' },
          },
        ],
      },
    });
    expect(
      executor.statements.map(function sql(statement) {
        return statement.sql;
      }),
    ).toEqual(['first', 'fail', 'recovery']);
    expect(result.step_errors[1]?.code).toBe('SQLITE_ERROR');
    expect(result.step_results[2]).toBeNull();
    expect(result.step_errors[2]).toBeNull();
    expect(result.step_results[3]?.rows).toEqual([[{ type: 'integer', value: '1' }]]);
  });

  test('resolves stored statements, defaults arguments, and rejects ambiguous SQL', async () => {
    const executor = new RecordingSqliteExecutor();
    const SQL_ID = 7;
    const result = await executeHranaBatch({
      executor,
      signal,
      storedSql: new Map([[SQL_ID, 'SELECT :name']]),
      batch: {
        steps: [
          {
            stmt: {
              sql_id: SQL_ID,
              named_args: [{ name: 'name', value: { type: 'text', value: 'value' } }],
              want_rows: false,
            },
          },
          { stmt: { sql: 'SELECT 1', sql_id: SQL_ID } },
        ],
      },
    });
    expect(executor.statements[0]?.sql).toBe('SELECT :name');
    expect(executor.statements[0]?.args).toEqual([]);
    expect(executor.statements[0]?.wantRows).toBe(false);
    expect(result.step_results[0]?.rows).toEqual([]);
    expect(result.step_errors[1]?.code).toBe('PROTO_ERROR');
  });

  test('reports forward conditions without executing their statements', async () => {
    const executor = new RecordingSqliteExecutor();
    const result = await executeHranaBatch({
      executor,
      signal,
      storedSql: new Map(),
      batch: { steps: [{ condition: { type: 'ok', step: 0 }, stmt: { sql: 'SELECT 1' } }] },
    });
    expect(executor.statements).toEqual([]);
    expect(result.step_errors[0]?.code).toBe('PROTO_ERROR');
  });

  test('propagates cancellation instead of turning it into a SQL error', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(
      executeHranaBatch({
        executor: new RecordingSqliteExecutor(),
        signal: controller.signal,
        storedSql: new Map(),
        batch: { steps: [{ stmt: { sql: 'SELECT 1' } }] },
      }),
    ).rejects.toThrow('cancelled');
  });
});
