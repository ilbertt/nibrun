import type { HranaDescribeResult, HranaStmtResult, SqliteStatement } from '@repo/sqlite';
import { HranaError, SqliteExecutorContract } from '@repo/sqlite';

export class RecordingSqliteExecutor extends SqliteExecutorContract {
  readonly statements: SqliteStatement[] = [];
  readonly sequences: string[] = [];
  closed = false;

  override execute({
    statement,
  }: {
    statement: SqliteStatement;
    signal: AbortSignal;
  }): Promise<HranaStmtResult> {
    this.statements.push(statement);
    if (statement.sql === 'fail') {
      return Promise.reject(new HranaError({ message: 'Statement failed', code: 'SQLITE_ERROR' }));
    }
    return Promise.resolve({
      cols: [{ name: 'value', decltype: null }],
      rows: statement.want_rows ? [[{ type: 'integer', value: '1' }]] : [],
      affected_row_count: 0,
      last_insert_rowid: null,
    });
  }

  override describe(_input: { sql: string; signal: AbortSignal }): Promise<HranaDescribeResult> {
    return Promise.resolve({
      params: [{ name: null }],
      cols: [{ name: 'value', decltype: null }],
      is_explain: false,
      is_readonly: true,
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
