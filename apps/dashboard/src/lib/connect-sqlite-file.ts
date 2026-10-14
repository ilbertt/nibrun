import {
  type SqliteFile,
  type SqliteFileConnectionEvent,
  sqliteFileConnectionChannel,
} from '#lib/sqlite-file-connection-events.ts';
import type { SqliteConnectionSummary } from '#queries/sqlite-connection.ts';

export async function connectSqliteFile({
  file,
  list,
  create,
  validate,
}: {
  file: SqliteFile;
  list: () => Promise<SqliteConnectionSummary[]>;
  create: () => Promise<SqliteConnectionSummary>;
  validate: (connection: SqliteConnectionSummary) => Promise<void>;
}): Promise<SqliteConnectionSummary> {
  const channel = sqliteFileConnectionChannel(file);
  function publish(event: SqliteFileConnectionEvent): void {
    channel.postMessage(event);
  }
  try {
    const connections = await list();
    const saved = connections.find((connection) => connection.sqlite_file_path === file.path);
    const connection = saved ?? (await create());
    await validate(connection);
    publish({ status: 'success', connection });
    return connection;
  } catch (failure) {
    const error = failure instanceof Error ? failure : new Error('Could not open this database.');
    publish({ status: 'error', message: error.message });
    throw error;
  } finally {
    channel.close();
  }
}
