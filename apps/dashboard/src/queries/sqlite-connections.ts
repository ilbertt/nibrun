import { unwrap } from '@repo/api-client/unwrap';
import { queryOptions } from '@tanstack/react-query';
import { api } from '#lib/api.ts';

async function fetchSqliteConnections(appId: string) {
  return unwrap(await api.api.apps({ appId }).sqlite.connections.get()).connections;
}

export type SqliteConnectionSummary = Awaited<ReturnType<typeof fetchSqliteConnections>>[number];

export function sqliteConnectionsQueryOptions(appId: string) {
  return queryOptions({
    queryKey: ['sqlite-connections', appId],
    queryFn: () => fetchSqliteConnections(appId),
  });
}
