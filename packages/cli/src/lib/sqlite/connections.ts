import type { PublicApiClient } from '@repo/api-client/public';
import { unwrap } from '@repo/api-client/unwrap';
import { z } from 'zod';
import { defineOutput, type Writer } from '#lib/output.ts';

type AppRoutes = ReturnType<PublicApiClient['api']['apps']>;
type ConnectionListing = NonNullable<
  Awaited<ReturnType<AppRoutes['sqlite']['connections']['get']>>['data']
>;
export type SqliteConnection = ConnectionListing['connections'][number];

export const SqliteConnectionSchema = z.object({
  id: z.string(),
  appId: z.string(),
  sqlite_file_path: z.string(),
  createdAt: z.string(),
  url: z.string(),
}) satisfies z.ZodType<SqliteConnection>;

export const SQLITE_CONNECTIONS_OUTPUT = defineOutput({
  schema: z.object({ connections: z.array(SqliteConnectionSchema) }),
  render: function render({ value, out }) {
    if (value.connections.length === 0) {
      out.info(
        'No saved SQLite connections. Use `nib apps sqlite connections create <path>` to add one.',
      );
      return;
    }
    for (const connection of value.connections) {
      renderSqliteConnection({ value: connection, out });
    }
  },
});

export function renderSqliteConnection({
  value,
  out,
}: {
  value: SqliteConnection;
  out: Writer;
}): void {
  out.info(`${value.id}  ${JSON.stringify(value.sqlite_file_path)}`);
  out.dim(`app: ${value.appId} · created: ${value.createdAt}`);
  out.info(value.url);
}

export async function listSqliteConnections({
  api,
  appId,
}: {
  api: PublicApiClient;
  appId: string;
}): Promise<ConnectionListing> {
  return unwrap(await api.api.apps({ appId }).sqlite.connections.get());
}
