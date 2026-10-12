import { describe, expect, mock, test } from 'bun:test';
import { connectSqliteFile } from '#lib/connect-sqlite-file.ts';
import {
  type SqliteFile,
  type SqliteFileConnectionEvent,
  sqliteFileConnectionChannel,
} from '#lib/sqlite-file-connection-events.ts';
import type { SqliteConnectionSummary } from '#queries/sqlite-connection.ts';

const file = { appId: 'app-1', path: '/data/app.db' };
const connection: SqliteConnectionSummary = {
  id: 'connection-1',
  appId: file.appId,
  sqlite_file_path: file.path,
  createdAt: '2026-10-12T00:00:00.000Z',
  url: 'https://nibrun.com/api/sqlite/connections/connection-1/',
};

function recordEvents(file: SqliteFile) {
  const channel = sqliteFileConnectionChannel(file);
  const events: SqliteFileConnectionEvent[] = [];
  const finished = Promise.withResolvers<void>();
  channel.onmessage = (event: MessageEvent<SqliteFileConnectionEvent>) => {
    events.push(event.data);
    channel.close();
    finished.resolve();
  };
  return { events, finished: finished.promise };
}

describe('connecting a file from the explorer tab', () => {
  test('creates a missing connection and sends it to the file list', async () => {
    const recorder = recordEvents(file);
    const create = mock(() => Promise.resolve(connection));

    expect(await connectSqliteFile({ file, list: () => Promise.resolve([]), create })).toEqual(
      connection,
    );
    await recorder.finished;

    expect(create).toHaveBeenCalledTimes(1);
    expect(recorder.events).toEqual([{ status: 'success', connection }]);
  });

  test('reuses an existing connection when a file link is reopened', async () => {
    const recorder = recordEvents(file);
    const create = mock(() => Promise.resolve(connection));

    expect(
      await connectSqliteFile({ file, list: () => Promise.resolve([connection]), create }),
    ).toEqual(connection);
    await recorder.finished;

    expect(create).not.toHaveBeenCalled();
    expect(recorder.events.at(-1)).toEqual({ status: 'success', connection });
  });

  test('sends the original creation error back to the file list and rejects', async () => {
    const recorder = recordEvents(file);
    const failure = new Error('file is not a database');

    await expect(
      connectSqliteFile({
        file,
        list: () => Promise.resolve([]),
        create: () => Promise.reject(failure),
      }),
    ).rejects.toBe(failure);
    await recorder.finished;

    expect(recorder.events).toEqual([{ status: 'error', message: failure.message }]);
  });
});
