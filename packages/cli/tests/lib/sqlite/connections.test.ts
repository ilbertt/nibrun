import { expect, test } from 'bun:test';
import { listSqliteConnections, SQLITE_CONNECTIONS_OUTPUT } from '#lib/sqlite/connections.ts';
import { answering, apiHolding, listedApp } from '#tests/support/api.ts';
import { APP_ID } from '#tests/support/app.ts';
import { writerRecording } from '#tests/support/output.ts';
import { sqliteConnection } from '#tests/support/sqlite.ts';

test('connection listings address the selected app and retain the API connection metadata', async () => {
  const addressed: string[] = [];
  const connections = [sqliteConnection()];
  const api = apiHolding({
    apps: [listedApp()],
    underApp: function underApp({ appId }) {
      addressed.push(appId);
      return { sqlite: { connections: { get: answering({ connections }) } } };
    },
  });
  const value = SQLITE_CONNECTIONS_OUTPUT.schema.parse(
    await listSqliteConnections({ api, appId: APP_ID }),
  );
  expect(addressed).toEqual([APP_ID]);
  expect(value).toEqual({ connections });
  const out = writerRecording();
  SQLITE_CONNECTIONS_OUTPUT.render({ value, out });
  for (const field of Object.values(connections[0]!)) {
    expect(out.said.join('\n')).toContain(field);
  }
});

test('an empty listing explains how to save a connection', () => {
  const out = writerRecording();
  SQLITE_CONNECTIONS_OUTPUT.render({ value: { connections: [] }, out });
  expect(out.said.join('\n')).toContain('nib apps sqlite connections create <path>');
});

test('failed listings report the API error instead of rendering an empty list', async () => {
  const api = apiHolding({
    apps: [listedApp()],
    underApp: function underApp() {
      return {
        sqlite: {
          connections: {
            get: function get() {
              return Promise.resolve({
                data: null,
                error: { status: 401, value: { error: 'Unauthorized' } },
              });
            },
          },
        },
      };
    },
  });
  await expect(listSqliteConnections({ api, appId: APP_ID })).rejects.toThrow('401: Unauthorized');
});

test('tenant paths cannot introduce extra lines in a connection listing', () => {
  const out = writerRecording();
  SQLITE_CONNECTIONS_OUTPUT.render({
    value: { connections: [sqliteConnection({ sqlite_file_path: '/two\nlines.db' })] },
    out,
  });
  expect(out.said[0]).toBe('connection-1  "/two\\nlines.db"');
});
