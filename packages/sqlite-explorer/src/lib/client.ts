import { createClient } from '@libsql/client/web';
import {
  groupSqliteForeignKeys,
  SQLITE_FOREIGN_KEY_QUERY,
  sqliteRowReferences,
} from '#lib/foreign-keys.ts';
import { type SqliteQuery, type SqliteQueryResponse, TABLE_PAGE_SIZE } from '#lib/query.ts';
import { displaySqliteValue } from '#lib/values.ts';

const QUERY_TIMEOUT_MS = 15_000;
function fetchDatabase(request: Request): Promise<Response> {
  return fetch(request, {
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
  });
}

export async function executeSqliteQuery(data: SqliteQuery): Promise<SqliteQueryResponse> {
  const client = createClient({
    url: data.url,
    authToken: data.authToken,
    intMode: 'bigint',
    fetch: fetchDatabase,
  });
  const started = performance.now();
  try {
    const response = await client.execute(
      data.offset === undefined
        ? data.sql
        : `SELECT * FROM (${data.sql}) LIMIT ${TABLE_PAGE_SIZE + 1} OFFSET ${data.offset}`,
    );
    const foreignKeys =
      data.table === undefined
        ? []
        : groupSqliteForeignKeys(
            (await client.execute({ sql: SQLITE_FOREIGN_KEY_QUERY, args: [data.table] })).rows,
          );
    const rows =
      data.offset === undefined ? response.rows : response.rows.slice(0, TABLE_PAGE_SIZE);
    return {
      references: rows.map((row) =>
        sqliteRowReferences({
          foreignKeys,
          values: Object.fromEntries(
            Array.from(response.columns.entries(), ([index, column]) => [column, row[index]!]),
          ),
        }),
      ),
      result: {
        fields: response.columns,
        rows: rows.map((row) =>
          Object.fromEntries(
            Array.from(response.columns.entries(), ([index, column]) => [
              column,
              displaySqliteValue(row[index]!),
            ]),
          ),
        ),
        columnTypes: Object.fromEntries(
          Array.from(response.columns.entries(), ([index, column]) => [
            column,
            response.columnTypes[index] ?? '',
          ]),
        ),
        rowCount: rows.length,
        pagination:
          data.offset === undefined
            ? undefined
            : {
                limit: TABLE_PAGE_SIZE,
                offset: data.offset,
                hasMore: response.rows.length > TABLE_PAGE_SIZE,
                totalReturned: data.offset + rows.length,
                wasLimited: true,
              },
        executionTime: performance.now() - started,
      },
      error: undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not query this database.';
    return {
      result: undefined,
      error: data.authToken ? message.replaceAll(data.authToken, '[redacted]') : message,
    };
  } finally {
    client.close();
  }
}
