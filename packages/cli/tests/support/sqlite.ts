import { createCli } from '@parshjs/core';
import type { PublicApiClient } from '@repo/api-client/public';
import { commandTree } from '#command-tree.gen.ts';
import type { SqliteConnection } from '#lib/sqlite/connections.ts';
import type { PipelineResponse } from '#lib/sqlite/query.ts';
import { answering, apiHolding, listedApp } from '#tests/support/api.ts';
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

export const SQLITE_FRACTION = 1.5;

export const SQLITE_QUERY_RESPONSE = {
  baton: null,
  base_url: null,
  results: [
    {
      type: 'ok',
      response: {
        type: 'execute',
        result: {
          cols: [
            { name: 'value', decltype: 'INTEGER' },
            { name: 'value', decltype: 'TEXT' },
            { name: null, decltype: null },
            { name: 'bytes', decltype: 'BLOB' },
            { name: 'fraction', decltype: 'REAL' },
          ],
          rows: [
            [
              { type: 'integer', value: '9223372036854775807' },
              { type: 'text', value: 'two\nlines' },
              { type: 'null' },
              { type: 'blob', base64: 'AP8=' },
              { type: 'float', value: SQLITE_FRACTION },
            ],
          ],
          affected_row_count: 0,
          last_insert_rowid: null,
        },
      },
    },
    { type: 'ok', response: { type: 'close' } },
  ],
} satisfies PipelineResponse;

export function sqliteQueryFixture({
  connections = [sqliteConnection()],
  response = SQLITE_QUERY_RESPONSE,
  failure = null,
}: {
  connections?: SqliteConnection[];
  response?: PipelineResponse;
  failure?: { status: number; value: { error: string } } | null;
} = {}) {
  const addressedApps: string[] = [];
  const pipelines: Array<{ connectionId: string; body: unknown }> = [];
  const listing = apiHolding({
    apps: [listedApp()],
    underApp: function underApp({ appId }) {
      addressedApps.push(appId);
      return { sqlite: { connections: { get: answering({ connections }) } } };
    },
  });
  const api = {
    api: {
      ...listing.api,
      sqlite: {
        connections: function addressedConnection({ connectionId }: { connectionId: string }) {
          return {
            v2: {
              pipeline: {
                post: function post(body: unknown) {
                  pipelines.push({ connectionId, body });
                  return Promise.resolve({ data: failure ? null : response, error: failure });
                },
              },
            },
          };
        },
      },
    },
  } as unknown as PublicApiClient;
  return { api, pipelines, addressedApps };
}

export function sqliteCli({ api, signedIn }: { api: PublicApiClient; signedIn: boolean }) {
  const errors: string[] = [];
  const apiUrl = 'https://example.invalid';
  const cli = createCli({
    programName: 'nib',
    tree: commandTree,
    context: {
      api,
      apiUrl,
      files: {
        credentials: {
          maybeRead: function maybeRead() {
            return Promise.resolve(signedIn ? { apiUrl, accessToken: 'test-token' } : null);
          },
        },
      },
    },
    onError: function onError({ error, exit }) {
      errors.push(error.message);
      return exit(1);
    },
  });
  return { cli, errors };
}
