import type { FilesystemEntry } from '@repo/api-client/models';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { childPath } from '#lib/child-path.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { useDirectoryPath } from '#lib/hooks/use-directory-path.ts';
import { useFailureToast } from '#lib/hooks/use-failure-toast.ts';
import { isSqliteFilename } from '#lib/is-sqlite-filename.ts';
import { sameOriginSqliteUrl } from '#lib/same-origin-sqlite-url.ts';
import {
  type SqliteFileConnectionEvent,
  sqliteFileConnectionChannel,
} from '#lib/sqlite-file-connection-events.ts';
import {
  type SqliteConnectionSummary,
  sqliteConnectionsQueryOptions,
} from '#queries/sqlite-connections.ts';
import { sqliteFileConnectionQueryOptions } from '#queries/sqlite-file-connection.ts';
import { Route as SqliteRoute, type SqliteSearch } from '#routes/sqlite.tsx';

export type FileSqliteConnection = {
  isDatabase: boolean;
  error: Error | null;
  search: SqliteSearch;
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
  const [status, setStatus] = useState<SqliteFileConnectionEvent>();
  const rememberConnection = useCallback(
    (connection: SqliteConnectionSummary): void => {
      const options = sqliteConnectionsQueryOptions(appId);
      queryClient.setQueryData(options.queryKey, (current) => [
        connection,
        ...(current ?? []).filter((saved) => saved.id !== connection.id),
      ]);
      void queryClient.invalidateQueries({ queryKey: options.queryKey });
    },
    [appId, queryClient],
  );
  const opening = useMutation({
    mutationFn: () =>
      queryClient.fetchQuery({
        ...sqliteFileConnectionQueryOptions({ appId, path }),
        staleTime: 0,
      }),
    onMutate: () => setStatus(undefined),
    onSuccess: (connection) => {
      rememberConnection(connection);
      return navigate({
        to: SqliteRoute.to,
        search: { url: connection.url, appId, path },
      });
    },
  });
  useEffect(() => {
    setStatus(undefined);
    const channel = sqliteFileConnectionChannel({ appId, path });
    channel.onmessage = (event: MessageEvent<SqliteFileConnectionEvent>) => {
      setStatus(event.data);
      if (event.data.status === 'success') {
        rememberConnection(event.data.connection);
      }
    };
    return () => channel.close();
  }, [appId, path, rememberConnection]);
  const error = opening.error ?? (status?.status === 'error' ? new Error(status.message) : null);
  useFailureToast(error?.message);

  const connection =
    saved === undefined
      ? undefined
      : {
          ...saved,
          url: sameOriginSqliteUrl(saved.url),
        };
  return {
    isDatabase: entry.kind === 'file' && (saved !== undefined || isSqliteFilename(entry.name)),
    error,
    search: { url: connection?.url ?? '', appId, path },
    isOpening: opening.isPending,
    open: () => opening.mutate(),
  };
}
