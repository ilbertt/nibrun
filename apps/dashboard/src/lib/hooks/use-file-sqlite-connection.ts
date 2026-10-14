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
import { sameOriginSqliteUrl } from '#lib/same-origin-sqlite-url.ts';
import { sqliteConnectionsQueryOptions } from '#queries/sqlite-connections.ts';
import { Route as SqliteRoute } from '#routes/sqlite.tsx';

export type FileSqliteConnection = {
  isDatabase: boolean;
  href: string | undefined;
  error: Error | null;
  isOpening: boolean;
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
  function explorerHref(url: string): string {
    return router.buildLocation({
      to: SqliteRoute.to,
      search: { url: sameOriginSqliteUrl(url) },
    }).href;
  }
  const opening = useMutation({
    mutationFn: async () =>
      unwrap(await api.api.apps({ appId }).sqlite.connections.post({ sqlite_file_path: path })),
    onSuccess: (connection) => {
      queryClient.setQueryData(options.queryKey, (current) => [
        connection,
        ...(current ?? []).filter((saved) => saved.id !== connection.id),
      ]);
      window.open(explorerHref(connection.url), '_blank', 'noopener');
    },
  });
  useFailureToast(opening.error?.message);

  return {
    isDatabase: entry.kind === 'file' && (saved !== undefined || isSqliteFilename(entry.name)),
    href: saved === undefined ? undefined : explorerHref(saved.url),
    error: opening.error,
    isOpening: connections.isPending || opening.isPending,
    open: () => opening.mutate(),
  };
}
