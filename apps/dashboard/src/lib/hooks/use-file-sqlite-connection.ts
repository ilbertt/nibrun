import type { FilesystemEntry } from '@repo/api-client/models';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
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
import type { SqliteSearch } from '#routes/sqlite.tsx';

export type FileSqliteConnection = {
  connection: SqliteConnectionSummary | undefined;
  isDatabase: boolean;
  error: Error | null;
  search: SqliteSearch;
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
  const [status, setStatus] = useState<SqliteFileConnectionEvent>();
  useEffect(() => {
    setStatus(undefined);
    const channel = sqliteFileConnectionChannel({ appId, path });
    channel.onmessage = (event: MessageEvent<SqliteFileConnectionEvent>) => {
      setStatus(event.data);
      if (event.data.status === 'success') {
        const connection = event.data.connection;
        const options = sqliteConnectionsQueryOptions(appId);
        queryClient.setQueryData(options.queryKey, (current) => [
          connection,
          ...(current ?? []).filter((saved) => saved.id !== connection.id),
        ]);
        void queryClient.invalidateQueries({ queryKey: options.queryKey });
      }
    };
    return () => channel.close();
  }, [appId, path, queryClient]);
  const error = status?.status === 'error' ? new Error(status.message) : null;
  useFailureToast(error?.message);

  const connection =
    saved === undefined
      ? undefined
      : {
          ...saved,
          url: sameOriginSqliteUrl(saved.url),
        };
  return {
    connection,
    isDatabase: entry.kind === 'file' && (saved !== undefined || isSqliteFilename(entry.name)),
    error,
    search: { url: connection?.url ?? '', appId, path },
  };
}
