import type { QueryResult } from '@libredb/studio/types';
import type { SqliteRowReference } from '#lib/foreign-keys.ts';

export const TABLE_PAGE_SIZE = 500;
export const SQLITE_SCHEMA_QUERY =
  "SELECT name, type, sql FROM sqlite_schema WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name";

export type SqliteConnection = { url: string; authToken: string };
export type SqliteQuery = SqliteConnection & {
  sql: string;
  offset: number | undefined;
  table: string | undefined;
};
export type SqliteQueryResponse =
  | { result: QueryResult; references: SqliteRowReference[][]; error: undefined }
  | { result: undefined; error: string };

export function tableQuery(name: string): string {
  return `SELECT * FROM ${sqliteIdentifier(name)}`;
}

export function sqliteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

const MAX_SQL_LENGTH = 65_536;

export function validateSqliteQuery(value: SqliteQuery): SqliteQuery {
  const url = new URL(value.url.trim().replace(/^libsql:/, 'https:'));
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Use an HTTP, HTTPS, or libsql:// database URL without credentials or query parameters.',
    );
  }
  if (value.offset !== undefined && (!Number.isSafeInteger(value.offset) || value.offset < 0)) {
    throw new Error('Invalid result page offset.');
  }
  if (!value.sql.trim() || value.sql.length > MAX_SQL_LENGTH) {
    throw new Error('Enter a SQL query shorter than 64 KiB.');
  }
  return {
    url: url.href,
    authToken: value.authToken.trim(),
    sql: value.sql,
    offset: value.offset,
    table: value.table,
  };
}
