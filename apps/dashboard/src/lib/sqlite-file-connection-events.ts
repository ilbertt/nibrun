import type { SqliteConnectionSummary } from '#queries/sqlite-connection.ts';

export type SqliteFile = { appId: string; path: string };
export type SqliteFileConnectionEvent =
  | { status: 'success'; connection: SqliteConnectionSummary }
  | { status: 'error'; message: string };

export function sqliteFileConnectionChannel(file: SqliteFile): BroadcastChannel {
  return new BroadcastChannel(`sqlite-file-connection:${JSON.stringify([file.appId, file.path])}`);
}
