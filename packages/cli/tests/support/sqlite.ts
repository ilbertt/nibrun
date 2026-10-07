import type { SqliteConnection } from '#lib/sqlite/connections.ts';
import { APP_ID } from '#tests/support/app.ts';

export function sqliteConnection(overrides: Partial<SqliteConnection> = {}): SqliteConnection {
  return {
    id: 'connection-1',
    appId: APP_ID,
    sqlite_file_path: '/app.db',
    createdAt: '2026-10-07T10:00:00.000Z',
    url: 'https://nibrun.com/api/sqlite/connections/connection-1/',
    ...overrides,
  };
}
