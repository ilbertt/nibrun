import type { SqliteConnectionSummary } from '#queries/sqlite-connections.ts';

export function dashboardSqliteConnection({
  connections,
  url,
  origin,
}: {
  connections: readonly SqliteConnectionSummary[];
  url: string;
  origin: string;
}): SqliteConnectionSummary | undefined {
  const connection = connections.find((item) => item.url === url);
  if (connection === undefined) {
    return undefined;
  }
  // The development dashboard proxies the API on a different port.
  const localUrl = new URL(new URL(connection.url).pathname, origin).href;
  return { ...connection, url: localUrl };
}
