import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import {
  type SqliteConnectionSummary,
  sqliteConnectionQueryOptions,
} from '#queries/sqlite-connection.ts';
import { Route } from '#routes/sqlite.tsx';

export function useSqliteConnection(): UseQueryResult<SqliteConnectionSummary, Error> {
  const { url } = Route.useSearch();
  return useQuery(sqliteConnectionQueryOptions(url));
}
