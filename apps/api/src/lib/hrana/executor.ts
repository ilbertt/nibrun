import type { SqliteDescribeResult, SqliteStatement, SqliteStatementResult } from '@repo/protocol';

export abstract class SqliteExecutorContract {
  abstract execute(input: {
    statement: SqliteStatement;
    signal: AbortSignal;
  }): Promise<SqliteStatementResult>;
  abstract describe(input: { sql: string; signal: AbortSignal }): Promise<SqliteDescribeResult>;
  abstract sequence(input: { sql: string; signal: AbortSignal }): Promise<void>;
  abstract close(): Promise<void>;
}
