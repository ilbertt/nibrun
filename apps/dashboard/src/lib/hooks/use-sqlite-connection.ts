import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import {
  type SqliteConnectionSummary,
  sqliteConnectionQueryOptions,
} from '#queries/sqlite-connection.ts';
import { sqliteFileConnectionQueryOptions } from '#queries/sqlite-file-connection.ts';
import { Route } from '#routes/sqlite.tsx';

export function useSqliteConnection(): UseQueryResult<SqliteConnectionSummary, Error> {
  const { url, appId, path } = Route.useSearch();
  return useQuery(
    url === ''
      ? sqliteFileConnectionQueryOptions({ appId, path })
      : sqliteConnectionQueryOptions(url),
  );
}
