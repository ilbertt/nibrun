import { describe, expect, test } from 'bun:test';
import type { SqliteStatement, SqliteStatementResult } from '@repo/protocol';
import { HranaPipelineAdapter } from '#lib/hrana/pipeline.ts';
import { HranaStreams } from '#lib/hrana/streams.ts';
import { openRecordingExecutor, RecordingSqliteExecutor } from '#tests/support/hrana/executor.ts';

const signal = new AbortController().signal;

function fixture() {
  const streams = new HranaStreams({ limit: undefined, idleTimeoutMs: undefined });
  const adapter = new HranaPipelineAdapter(streams);
  const executor = new RecordingSqliteExecutor();
  const open = openRecordingExecutor(executor);
  return { streams, adapter, executor, open };
}

describe('Hrana HTTP pipelines', () => {
  test('keeps streams valid after SQL errors and executes the remaining requests', async () => {
    const { streams, adapter, executor, open } = fixture();
    try {
      const response = await adapter.handle({
        body: {
          baton: null,
          requests: [
            { type: 'execute', stmt: { sql: 'fail' } },
            { type: 'execute', stmt: { sql: 'SELECT 1' } },
          ],
        },
        scope: 'owner/selection',
        open,
        signal,
      });
      expect(
        response.results.map(function outcome(result) {
          return result.type;
        }),
      ).toEqual(['error', 'ok']);
      expect(response.baton).not.toBeNull();
      expect(executor.closed).toBe(false);
    } finally {
      await streams.closeAll();
    }
  });

  test('stores SQL within one stream and supports description, sequence, and explicit close', async () => {
    const { streams, adapter, executor, open } = fixture();
    const SQL_ID = 7;
    try {
      const first = await adapter.handle({
        body: {
          baton: null,
          requests: [
            { type: 'store_sql', sql_id: SQL_ID, sql: 'SELECT ?' },
            { type: 'store_sql', sql_id: SQL_ID, sql: 'SELECT 2' },
          ],
        },
        scope: 'owner/selection',
        open,
        signal,
      });
      expect(first.results[1]?.type).toBe('error');
      const second = await adapter.handle({
        body: {
          baton: first.baton,
          requests: [
            { type: 'describe', sql_id: SQL_ID },
            { type: 'sequence', sql: 'SELECT 1; SELECT 2' },
            { type: 'close_sql', sql_id: SQL_ID },
            { type: 'execute', stmt: { sql_id: SQL_ID } },
            { type: 'close' },
            { type: 'execute', stmt: { sql: 'SELECT 1' } },
          ],
        },
        scope: 'owner/selection',
        open,
        signal,
      });
      expect(
        second.results.map(function outcome(result) {
          return result.type;
        }),
      ).toEqual(['ok', 'ok', 'ok', 'error', 'ok', 'error']);
      expect(second.baton).toBeNull();
      expect(executor.sequences).toEqual(['SELECT 1; SELECT 2']);
      expect(executor.closed).toBe(true);
    } finally {
      await streams.closeAll();
    }
  });

  test('closes the stream when request cancellation interrupts execution', async () => {
    const controller = new AbortController();
    class InterruptedExecutor extends RecordingSqliteExecutor {
      override execute(_input: {
        statement: SqliteStatement;
        signal: AbortSignal;
      }): Promise<SqliteStatementResult> {
        controller.abort(new Error('cancelled'));
        return Promise.reject(controller.signal.reason);
      }
    }
    const { streams, adapter } = fixture();
    const executor = new InterruptedExecutor();
    await expect(
      adapter.handle({
        body: { baton: null, requests: [{ type: 'execute', stmt: { sql: 'SELECT 1' } }] },
        scope: 'owner/selection',
        open: openRecordingExecutor(executor),
        signal: controller.signal,
      }),
    ).rejects.toThrow('cancelled');
    expect(executor.closed).toBe(true);
    await streams.closeAll();
  });

  test('fails oversized responses instead of silently truncating rows', async () => {
    const TOO_MANY_BYTES = 4_194_305;
    class OversizedExecutor extends RecordingSqliteExecutor {
      override execute(_input: {
        statement: SqliteStatement;
        signal: AbortSignal;
      }): Promise<SqliteStatementResult> {
        return Promise.resolve({
          columns: [{ name: 'value' }],
          rows: [[{ type: 'text', value: 'x'.repeat(TOO_MANY_BYTES) }]],
          affectedRowCount: 0,
        });
      }
    }
    const { streams, adapter } = fixture();
    const executor = new OversizedExecutor();
    await expect(
      adapter.handle({
        body: { baton: null, requests: [{ type: 'execute', stmt: { sql: 'SELECT 1' } }] },
        scope: 'owner/selection',
        open: openRecordingExecutor(executor),
        signal,
      }),
    ).rejects.toThrow('response limit');
    expect(executor.closed).toBe(true);
    await streams.closeAll();
  });
});
