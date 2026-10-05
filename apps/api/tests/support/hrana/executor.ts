import type { SqliteDescribeResult, SqliteStatement, SqliteStatementResult } from '@repo/protocol';
import { HranaError } from '#lib/hrana/errors.ts';
import { SqliteExecutorContract } from '#lib/hrana/executor.ts';

export class RecordingSqliteExecutor extends SqliteExecutorContract {
  readonly statements: SqliteStatement[] = [];
  readonly sequences: string[] = [];
  closed = false;

  override execute({
    statement,
  }: {
    statement: SqliteStatement;
    signal: AbortSignal;
  }): Promise<SqliteStatementResult> {
    this.statements.push(statement);
    if (statement.sql === 'fail') {
      return Promise.reject(new HranaError({ message: 'Statement failed', code: 'SQLITE_ERROR' }));
    }
    return Promise.resolve({
      columns: [{ name: 'value' }],
      rows: statement.wantRows ? [[{ type: 'integer', value: '1' }]] : [],
      affectedRowCount: 0,
    });
  }

  override describe(_input: { sql: string; signal: AbortSignal }): Promise<SqliteDescribeResult> {
    return Promise.resolve({
      parameters: [{}],
      columns: [{ name: 'value' }],
      isExplain: false,
      isReadonly: true,
    });
  }

  override sequence({ sql }: { sql: string; signal: AbortSignal }): Promise<void> {
    this.sequences.push(sql);
    return Promise.resolve();
  }

  override close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

export function openRecordingExecutor(executor: RecordingSqliteExecutor) {
  return function open(_input: { signal: AbortSignal }) {
    return Promise.resolve(executor);
  };
}
