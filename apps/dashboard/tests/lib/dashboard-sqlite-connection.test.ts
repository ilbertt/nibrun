import { describe, expect, test } from 'bun:test';
import { dashboardSqliteConnection } from '#lib/dashboard-sqlite-connection.ts';
import type { SqliteConnectionSummary } from '#queries/sqlite-connections.ts';

const CONNECTION = {
  id: 'connection-1',
  appId: 'app-1',
  sqlite_file_path: '/data/database.sqlite',
  url: 'https://app.nibrun.com/api/sqlite/connections/connection-1/',
  createdAt: '2026-10-08T12:00:00.000Z',
} as SqliteConnectionSummary;

function resolve(url: string) {
  return dashboardSqliteConnection({
    connections: [CONNECTION],
    url,
    origin: 'http://localhost:3001',
  });
}

describe('dashboard SQLite targets', () => {
  test('uses only a saved connection URL and sends queries through the dashboard origin', () => {
    expect(resolve(CONNECTION.url)).toEqual({
      ...CONNECTION,
      url: 'http://localhost:3001/api/sqlite/connections/connection-1/',
    });
  });
  test.each([
    '',
    'https://other.example/api/sqlite/connections/connection-1/',
    'https://app.nibrun.com/api/sqlite/connections/another-app/',
    'https://app.nibrun.com/api/apps',
    `${CONNECTION.url}?token=secret`,
  ])('does not open an unregistered URL: %s', (url) => {
    expect(resolve(url)).toBeUndefined();
  });
});
