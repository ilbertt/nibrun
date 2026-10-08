import type { FilesystemEntry } from '@repo/api-client/models';
import { useQuery } from '@tanstack/react-query';
import { childPath } from '#lib/child-path.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { useDirectoryPath } from '#lib/hooks/use-directory-path.ts';
import {
  type SqliteConnectionSummary,
  sqliteConnectionsQueryOptions,
} from '#queries/sqlite-connections.ts';

export function useFileSqliteConnection(
  entry: FilesystemEntry,
): SqliteConnectionSummary | undefined {
  const connections = useQuery(sqliteConnectionsQueryOptions(useAppId()));
  const path = childPath({ path: useDirectoryPath(), name: entry.name });
  return entry.kind === 'file'
    ? connections.data?.find((connection) => connection.sqlite_file_path === path)
    : undefined;
}
