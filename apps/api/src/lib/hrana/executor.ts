import type { HranaDescribeResult, HranaStmtResult, SqliteStatement } from '@repo/protocol';

export abstract class SqliteExecutorContract {
  abstract execute(input: {
    statement: SqliteStatement;
    signal: AbortSignal;
  }): Promise<HranaStmtResult>;
  abstract describe(input: { sql: string; signal: AbortSignal }): Promise<HranaDescribeResult>;
  abstract sequence(input: { sql: string; signal: AbortSignal }): Promise<void>;
  abstract close(): Promise<void>;
}
