import type { FilesystemEntry } from '@repo/api-client/models';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { childPath } from '#lib/child-path.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { useDirectoryPath } from '#lib/hooks/use-directory-path.ts';
import { useFailureToast } from '#lib/hooks/use-failure-toast.ts';
import { isSqliteFilename } from '#lib/is-sqlite-filename.ts';
import { sqliteConnectionsQueryOptions } from '#queries/sqlite-connections.ts';
import { sqliteFileConnectionQueryOptions } from '#queries/sqlite-file-connection.ts';
import { Route as SqliteRoute } from '#routes/sqlite.tsx';

export type FileSqliteConnection = {
  isDatabase: boolean;
  error: Error | null;
  isOpening: boolean;
  open: () => void;
};

export function useFileSqliteConnection(entry: FilesystemEntry): FileSqliteConnection {
  const appId = useAppId();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const options = sqliteConnectionsQueryOptions(appId);
  const connections = useQuery(options);
  const path = childPath({ path: useDirectoryPath(), name: entry.name });
  const saved =
    entry.kind === 'file'
      ? connections.data?.find((connection) => connection.sqlite_file_path === path)
      : undefined;
  const opening = useMutation({
    mutationFn: () =>
      queryClient.fetchQuery({
        ...sqliteFileConnectionQueryOptions({ appId, path }),
        staleTime: 0,
      }),
    onSuccess: (connection) => {
      queryClient.setQueryData(options.queryKey, (current) => [
        connection,
        ...(current ?? []).filter((saved) => saved.id !== connection.id),
      ]);
      void queryClient.invalidateQueries({ queryKey: options.queryKey });
      return navigate({
        to: SqliteRoute.to,
        search: { url: connection.url },
      });
    },
  });
  useFailureToast(opening.error?.message);

  return {
    isDatabase: entry.kind === 'file' && (saved !== undefined || isSqliteFilename(entry.name)),
    error: opening.error,
    isOpening: opening.isPending,
    open: () => opening.mutate(),
  };
}
