import { expect, test } from 'bun:test';
import { createSqliteConnection, SQLITE_CONNECTION_CREATED_OUTPUT } from '#lib/sqlite/create.ts';
import { answering, apiHolding, listedApp } from '#tests/support/api.ts';
import { APP_ID } from '#tests/support/app.ts';
import { writerRecording } from '#tests/support/output.ts';
import { sqliteConnection } from '#tests/support/sqlite.ts';

test('creating a connection uses the same volume-relative path normalization as file commands', async () => {
  const requests: Array<{ appId: string; sqlite_file_path: string }> = [];
  const connection = sqliteConnection({ sqlite_file_path: '/databases/app.db' });
  const api = apiHolding({
    apps: [listedApp()],
    underApp: function underApp({ appId }) {
      return {
        sqlite: {
          connections: {
            post: function post({ sqlite_file_path }: { sqlite_file_path: string }) {
              requests.push({ appId, sqlite_file_path });
              return answering(connection)();
            },
          },
        },
      };
    },
  });
  const value = SQLITE_CONNECTION_CREATED_OUTPUT.schema.parse(
    await createSqliteConnection({ api, appId: APP_ID, path: 'databases/app.db' }),
  );
  expect(requests).toEqual([{ appId: APP_ID, sqlite_file_path: '/databases/app.db' }]);
  expect(value).toEqual(connection);
  const out = writerRecording();
  SQLITE_CONNECTION_CREATED_OUTPUT.render({ value, out });
  expect(out.said).toContain(connection.url);
  expect(out.said.join('\n')).toContain(connection.id);
});

test('paths outside the volume are refused before making an API request', async () => {
  let requests = 0;
  const api = apiHolding({
    apps: [listedApp()],
    underApp: function underApp() {
      requests += 1;
      return {};
    },
  });
  await expect(
    createSqliteConnection({ api, appId: APP_ID, path: '../../etc/app.db' }),
  ).rejects.toThrow('is not a path inside an app filesystem');
  expect(requests).toBe(0);
});

test('a database validation failure is reported without claiming a connection was saved', async () => {
  const api = apiHolding({
    apps: [listedApp()],
    underApp: function underApp() {
      return {
        sqlite: {
          connections: {
            post: function post() {
              return Promise.resolve({
                data: null,
                error: { status: 400, value: { error: 'Not a SQLite database.' } },
              });
            },
          },
        },
      };
    },
  });
  await expect(createSqliteConnection({ api, appId: APP_ID, path: '/app.db' })).rejects.toThrow(
    '400: Not a SQLite database.',
  );
});
