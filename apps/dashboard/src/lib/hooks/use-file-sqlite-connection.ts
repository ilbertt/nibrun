import type { FilesystemEntry } from '@repo/api-client/models';
import { unwrap } from '@repo/api-client/unwrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { api } from '#lib/api.ts';
import { childPath } from '#lib/child-path.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { useDirectoryPath } from '#lib/hooks/use-directory-path.ts';
import { useFailureToast } from '#lib/hooks/use-failure-toast.ts';
import { isSqliteFilename } from '#lib/is-sqlite-filename.ts';
import { openSqliteExplorer } from '#lib/open-sqlite-explorer.ts';
import { sameOriginSqliteUrl } from '#lib/same-origin-sqlite-url.ts';
import {
  type SqliteConnectionSummary,
  sqliteConnectionsQueryOptions,
} from '#queries/sqlite-connections.ts';
import { Route as SqliteRoute } from '#routes/sqlite.tsx';

export type FileSqliteConnection = {
  connection: SqliteConnectionSummary | undefined;
  isDatabase: boolean;
  canOpen: boolean;
  isPending: boolean;
  error: Error | null;
  open: () => void;
};

export function useFileSqliteConnection(entry: FilesystemEntry): FileSqliteConnection {
  const appId = useAppId();
  const queryClient = useQueryClient();
  const router = useRouter();
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
  const canOpen = entry.kind === 'file' && connections.isSuccess && !creation.isPending;
  return {
    connection,
    isDatabase: entry.kind === 'file' && (saved !== undefined || isSqliteFilename(entry.name)),
    canOpen,
    isPending: creation.isPending,
    error: creation.error,
    open: () => {
      if (!canOpen) {
        return;
      }
      void openSqliteExplorer({
        getUrl: async () =>
          connection?.url ?? sameOriginSqliteUrl((await creation.mutateAsync()).url),
        getHref: (url) => router.buildLocation({ to: SqliteRoute.to, search: { url } }).href,
      }).catch(() => {});
    },
  };
}
