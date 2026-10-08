import { unwrap } from '@repo/api-client/unwrap';
import { queryOptions } from '@tanstack/react-query';
import { api } from '#lib/api.ts';
import { sameOriginSqliteUrl } from '#lib/same-origin-sqlite-url.ts';

async function fetchSqliteConnection(url: string) {
  const connectionId = new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '';
  const connection = unwrap(await api.api.sqlite.connections({ connectionId }).get());
  return { ...connection, url: sameOriginSqliteUrl(connection.url) };
}

export type SqliteConnectionSummary = Awaited<ReturnType<typeof fetchSqliteConnection>>;

export function sqliteConnectionQueryOptions(url: string) {
  return queryOptions({
    queryKey: ['sqlite-connection', url],
    queryFn: () => fetchSqliteConnection(url),
    enabled: url !== '',
    retry: false,
  });
}
