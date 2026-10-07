import { select } from '@clack/prompts';
import type { PublicApiClient } from '@repo/api-client/public';
import { UsageError } from '#lib/errors.ts';
import { answered } from '#lib/prompts.ts';
import { listSqliteConnections, type SqliteConnection } from '#lib/sqlite/connections.ts';

export async function selectSqliteConnection({
  api,
  appId,
  connectionId,
  interactive,
}: {
  api: PublicApiClient;
  appId: string;
  connectionId: string | undefined;
  interactive: boolean;
}): Promise<SqliteConnection> {
  const { connections } = await listSqliteConnections({ api, appId });
  if (connectionId !== undefined) {
    return namedConnection({ connections, connectionId });
  }
  const [only] = connections;
  if (only === undefined) {
    throw new UsageError(
      'No saved SQLite connections. Use `nib apps sqlite connections create <path>` to add one.',
    );
  }
  if (connections.length === 1) {
    return only;
  }
  if (!interactive) {
    throw new UsageError(
      'Which SQLite connection? Pass --connection with an ID from `nib apps sqlite connections list`.',
    );
  }
  const chosen = answered(
    await select({
      message: 'Which SQLite database?',
      options: connections.map(function option(connection) {
        return {
          value: connection.id,
          label: JSON.stringify(connection.sqlite_file_path),
          hint: connection.id,
        };
      }),
    }),
  );
  return namedConnection({ connections, connectionId: chosen });
}

function namedConnection({
  connections,
  connectionId,
}: {
  connections: SqliteConnection[];
  connectionId: string;
}): SqliteConnection {
  const connection = connections.find(function matching(candidate) {
    return candidate.id === connectionId;
  });
  if (connection === undefined) {
    throw new UsageError(`No SQLite connection ${connectionId} saved for this app.`);
  }
  return connection;
}
