import { describe, expect, mock, test } from 'bun:test';
import { connectSqliteFile } from '#lib/connect-sqlite-file.ts';
import type { SqliteConnectionSummary } from '#queries/sqlite-connection.ts';

const file = { appId: 'app-1', path: '/data/app.db' };
const connection: SqliteConnectionSummary = {
  id: 'connection-1',
  appId: file.appId,
  sqlite_file_path: file.path,
  createdAt: '2026-10-12T00:00:00.000Z',
  url: 'https://nibrun.com/api/sqlite/connections/connection-1/',
};

function validateConnection(): Promise<void> {
  return Promise.resolve();
}

describe('connecting a file for the SQLite explorer', () => {
  test('creates a missing connection before opening the explorer', async () => {
    const create = mock(() => Promise.resolve(connection));

    expect(
      await connectSqliteFile({
        file,
        list: () => Promise.resolve([]),
        create,
        validate: validateConnection,
      }),
    ).toEqual(connection);

    expect(create).toHaveBeenCalledTimes(1);
  });

  test('reuses an existing connection when a file link is reopened', async () => {
    const create = mock(() => Promise.resolve(connection));

    expect(
      await connectSqliteFile({
        file,
        list: () => Promise.resolve([connection]),
        create,
        validate: validateConnection,
      }),
    ).toEqual(connection);

    expect(create).not.toHaveBeenCalled();
  });

  test('rejects with the original creation error', async () => {
    const failure = new Error('file is not a database');

    await expect(
      connectSqliteFile({
        file,
        list: () => Promise.resolve([]),
        create: () => Promise.reject(failure),
        validate: validateConnection,
      }),
    ).rejects.toBe(failure);
  });

  test('waits for database validation before returning a link', async () => {
    const checked = Promise.withResolvers<void>();
    const checking = Promise.withResolvers<SqliteConnectionSummary>();
    const returned = mock();
    const connecting = connectSqliteFile({
      file,
      list: () => Promise.resolve([]),
      create: () => Promise.resolve(connection),
      validate: (candidate) => {
        checking.resolve(candidate);
        return checked.promise;
      },
    }).then(returned);

    expect(await checking.promise).toEqual(connection);
    expect(returned).not.toHaveBeenCalled();

    checked.resolve();
    await connecting;
    expect(returned).toHaveBeenCalledWith(connection);
  });

  test.each([false, true])('rejects an unusable database (saved: %s)', async (saved) => {
    const failure = new Error('file is not a database');
    const validate = mock(() => Promise.reject(failure));

    await expect(
      connectSqliteFile({
        file,
        list: () => Promise.resolve(saved ? [connection] : []),
        create: () => Promise.resolve(connection),
        validate,
      }),
    ).rejects.toBe(failure);

    expect(validate).toHaveBeenCalledWith(connection);
  });
});
