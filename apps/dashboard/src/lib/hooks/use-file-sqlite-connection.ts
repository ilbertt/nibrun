import type { FilesystemEntry } from '@repo/api-client/models';
import { unwrap } from '@repo/api-client/unwrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '#lib/api.ts';
import { childPath } from '#lib/child-path.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { useDirectoryPath } from '#lib/hooks/use-directory-path.ts';
import { useFailureToast } from '#lib/hooks/use-failure-toast.ts';
import { sameOriginSqliteUrl } from '#lib/same-origin-sqlite-url.ts';
import {
  type SqliteConnectionSummary,
  sqliteConnectionsQueryOptions,
} from '#queries/sqlite-connections.ts';

export type FileSqliteConnection = {
  connection: SqliteConnectionSummary | undefined;
  canCreate: boolean;
  isPending: boolean;
  error: Error | null;
  create: () => void;
};

export function useFileSqliteConnection(entry: FilesystemEntry): FileSqliteConnection {
  const appId = useAppId();
  const queryClient = useQueryClient();
  const options = sqliteConnectionsQueryOptions(appId);
  const connections = useQuery(options);
  const path = childPath({ path: useDirectoryPath(), name: entry.name });
  const saved =
    entry.kind === 'file'
      ? connections.data?.find((connection) => connection.sqlite_file_path === path)
      : undefined;
  const creation = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.api.apps({ appId }).sqlite.connections.post({
          sqlite_file_path: path,
        }),
      ),
    onSuccess: (connection) => {
      queryClient.setQueryData(options.queryKey, (current) => [
        connection,
        ...(current ?? []).filter((saved) => saved.id !== connection.id),
      ]);
      return queryClient.invalidateQueries({ queryKey: options.queryKey });
    },
  });
  useFailureToast(creation.error?.message);

  const connection =
    saved === undefined
      ? undefined
      : {
          ...saved,
          url: sameOriginSqliteUrl(saved.url),
        };
  return {
    connection,
    canCreate: entry.kind === 'file' && saved === undefined && connections.isSuccess,
    isPending: creation.isPending,
    error: creation.error,
    create: () => creation.mutate(),
  };
}
