import { unwrap } from '@repo/api-client/unwrap';
import { executeSqliteQuery } from '@repo/app-operations';
import { queryOptions } from '@tanstack/react-query';
import { api } from '#lib/api.ts';
import { connectSqliteFile, type SqliteFile } from '#lib/connect-sqlite-file.ts';
import { sameOriginSqliteUrl } from '#lib/same-origin-sqlite-url.ts';
import { fetchSqliteConnections } from '#queries/sqlite-connections.ts';

export function sqliteFileConnectionQueryOptions(file: SqliteFile) {
  return queryOptions({
    queryKey: ['sqlite-file-connection', file.appId, file.path],
    queryFn: async () => {
      const connection = await connectSqliteFile({
        file,
        list: () => fetchSqliteConnections(file.appId),
        create: async () =>
          unwrap(
            await api.api.apps({ appId: file.appId }).sqlite.connections.post({
              sqlite_file_path: file.path,
            }),
          ),
        validate: async (connection) => {
          await executeSqliteQuery({
            api,
            connectionId: connection.id,
            sql: 'SELECT name FROM sqlite_schema LIMIT 0',
          });
        },
      });
      return { ...connection, url: sameOriginSqliteUrl(connection.url) };
    },
    enabled: file.appId !== '' && file.path !== '',
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}
