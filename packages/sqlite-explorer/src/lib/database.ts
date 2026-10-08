import { executeSqliteQuery } from '#lib/client.ts';
import type { ExplorerLocation } from '#lib/explorer-state.ts';
import {
  SQLITE_SCHEMA_QUERY,
  type SqliteConnection,
  tableQuery,
  validateSqliteQuery,
} from '#lib/query.ts';

export async function openSqliteDatabase(connection: SqliteConnection) {
  const schema = await executeSqliteQuery(
    validateSqliteQuery({
      ...connection,
      sql: SQLITE_SCHEMA_QUERY,
      offset: undefined,
      table: undefined,
    }),
  );
  if (schema.error !== undefined) {
    throw new Error(schema.error);
  }
  const table = schema.result.rows[0]?.name;
  const location: ExplorerLocation = {
    query: '',
    view: 'table',
    resultQuery: '',
    resultTable: undefined,
    result: undefined,
    references: [],
  };
  if (table !== undefined) {
    const sql = tableQuery(String(table));
    const response = await executeSqliteQuery(
      validateSqliteQuery({ ...connection, sql, offset: 0, table: String(table) }),
    );
    if (response.error !== undefined) {
      throw new Error(response.error);
    }
    return {
      tables: schema.result.rows,
      location: {
        ...location,
        query: sql,
        resultQuery: sql,
        resultTable: String(table),
        result: response.result,
        references: response.references,
      },
    };
  }
  return { tables: schema.result.rows, location };
}
