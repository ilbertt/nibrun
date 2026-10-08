import type { StudioWorkspaceProps, WorkspaceQueryResult } from '@libredb/studio/workspace';
import type { SqliteDatabase } from '#lib/client.ts';
import { displaySqliteValue } from '#lib/values.ts';

type QueryOptions = Parameters<StudioWorkspaceProps['onQueryExecute']>[2];

export async function executeWorkspaceQuery({
  database,
  sql,
  options,
}: {
  database: SqliteDatabase;
  sql: string;
  options: QueryOptions;
}): Promise<WorkspaceQueryResult> {
  const started = performance.now();
  const page =
    options?.unlimited === true || options?.limit === undefined
      ? undefined
      : {
          limit: options.limit,
          offset: options.offset ?? 0,
        };
  const result = await database.execute(
    page ? `SELECT * FROM (${sql}) LIMIT ${page.limit + 1} OFFSET ${page.offset}` : sql,
  );
  const rows = page ? result.rows.slice(0, page.limit) : result.rows;
  return {
    fields: result.columns,
    columns: Array.from(result.columns.entries(), ([index, name]) => ({
      name,
      type: result.columnTypes[index] ?? '',
    })),
    rows: rows.map((row) =>
      Object.fromEntries(
        Array.from(result.columns.entries(), ([index, column]) => [
          column,
          displaySqliteValue(row[index]!),
        ]),
      ),
    ),
    rowCount: rows.length,
    executionTime: performance.now() - started,
    ...(page
      ? {
          pagination: {
            ...page,
            hasMore: result.rows.length > page.limit,
            totalReturned: page.offset + rows.length,
            wasLimited: true,
          },
        }
      : {}),
  };
}
