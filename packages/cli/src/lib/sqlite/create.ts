import type { PublicApiClient } from '@repo/api-client/public';
import { unwrap } from '@repo/api-client/unwrap';
import { typedPath } from '#lib/filesystem.ts';
import { defineOutput } from '#lib/output.ts';
import {
  renderSqliteConnection,
  type SqliteConnection,
  SqliteConnectionSchema,
} from '#lib/sqlite/connections.ts';

export const SQLITE_CONNECTION_CREATED_OUTPUT = defineOutput({
  schema: SqliteConnectionSchema,
  render: function render({ value, out }) {
    renderSqliteConnection({ value, out });
    out.done('Saved SQLite connection.');
  },
});

export async function createSqliteConnection({
  api,
  appId,
  path,
}: {
  api: PublicApiClient;
  appId: string;
  path: string;
}): Promise<SqliteConnection> {
  const sqlite_file_path = typedPath(path);
  return unwrap(await api.api.apps({ appId }).sqlite.connections.post({ sqlite_file_path }));
}
