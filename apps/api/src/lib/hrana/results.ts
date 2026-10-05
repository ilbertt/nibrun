import type { SqliteDescribeResult, SqliteStatementResult } from '@repo/protocol';

export function hranaStatementResult(result: SqliteStatementResult) {
  return {
    cols: result.columns.map(function describeColumn(column) {
      return { name: column.name, decltype: column.declaredType ?? null };
    }),
    rows: result.rows,
    affected_row_count: result.affectedRowCount,
    last_insert_rowid: result.lastInsertRowid ?? null,
  };
}

export type HranaStatementResult = ReturnType<typeof hranaStatementResult>;

export function hranaDescribeResult(result: SqliteDescribeResult) {
  return {
    params: result.parameters.map(function describeParameter(parameter) {
      return { name: parameter.name ?? null };
    }),
    cols: result.columns.map(function describeColumn(column) {
      return { name: column.name, decltype: column.declaredType ?? null };
    }),
    is_explain: result.isExplain,
    is_readonly: result.isReadonly,
  };
}
