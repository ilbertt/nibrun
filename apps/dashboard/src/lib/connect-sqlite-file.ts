import type { SqliteConnectionSummary } from '#queries/sqlite-connection.ts';

export type SqliteFile = { appId: string; path: string };

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
  const connections = await list();
  const saved = connections.find((connection) => connection.sqlite_file_path === file.path);
  const connection = saved ?? (await create());
  await validate(connection);
  return connection;
}
