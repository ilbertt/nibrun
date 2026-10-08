import type { SqlitePipelineResponse, SqliteStatementResult } from '@repo/api-client/models';
import type { PublicApiClient } from '@repo/api-client/public';
import { unwrap } from '@repo/api-client/unwrap';

export async function executeSqliteQuery({
  api,
  connectionId,
  sql,
}: {
  api: PublicApiClient;
  connectionId: string;
  sql: string;
}): Promise<SqliteStatementResult> {
  const response = unwrap(
    await api.api.sqlite.connections({ connectionId }).v2.pipeline.post({
      baton: null,
      requests: [{ type: 'execute', stmt: { sql, want_rows: true } }, { type: 'close' }],
    }),
  );
  return statementResult(response);
}

function statementResult(response: SqlitePipelineResponse): SqliteStatementResult {
  const [execution, closing] = response.results;
  if (execution?.type === 'error') {
    throw new Error(sqliteFailureMessage(execution.error));
  }
  if (closing?.type === 'error') {
    throw new Error(sqliteFailureMessage(closing.error));
  }
  if (
    execution?.type !== 'ok' ||
    execution.response.type !== 'execute' ||
    closing?.type !== 'ok' ||
    closing.response.type !== 'close' ||
    response.baton !== null
  ) {
    throw new Error('The API returned an unexpected SQLite query response.');
  }
  return execution.response.result;
}

function sqliteFailureMessage(
  error: Extract<SqlitePipelineResponse['results'][number], { type: 'error' }>['error'],
): string {
  return error.code ? `${error.code}: ${error.message}` : error.message;
}
