import { expect, test } from 'bun:test';
import type { SqlitePipelineResponse, SqliteStatementResult } from '@repo/api-client/models';
import type { PublicApiClient } from '@repo/api-client/public';
import { executeSqliteQuery } from '#sqlite.ts';

const CONNECTION_ID = 'connection-1';
const STATEMENT_RESULT = {
  cols: [{ name: 'value', decltype: 'INTEGER' }],
  rows: [[{ type: 'integer', value: '9223372036854775807' }]],
  affected_row_count: 0,
  last_insert_rowid: null,
} satisfies SqliteStatementResult;
const QUERY_RESPONSE = {
  baton: null,
  base_url: null,
  results: [
    { type: 'ok', response: { type: 'execute', result: STATEMENT_RESULT } },
    { type: 'ok', response: { type: 'close' } },
  ],
} satisfies SqlitePipelineResponse;

function fixture({
  response = QUERY_RESPONSE,
  failure = null,
}: {
  response?: SqlitePipelineResponse;
  failure?: { status: number; value: { error: string } } | null;
} = {}) {
  const pipelines: Array<{ connectionId: string; body: unknown }> = [];
  const api = {
    api: {
      sqlite: {
        connections: function addressed({ connectionId }: { connectionId: string }) {
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
  return { api, pipelines };
}

test('a query executes and closes in one pipeline and returns the API’s unconverted statement result', async () => {
  const { api, pipelines } = fixture();
  const sql = 'SELECT value FROM sample LIMIT 20';
  expect(await executeSqliteQuery({ api, connectionId: CONNECTION_ID, sql })).toEqual(
    STATEMENT_RESULT,
  );
  expect(pipelines).toEqual([
    {
      connectionId: CONNECTION_ID,
      body: {
        baton: null,
        requests: [{ type: 'execute', stmt: { sql, want_rows: true } }, { type: 'close' }],
      },
    },
  ]);
});

test.each(['SQLITE_AUTH', 'SQLITE_ERROR'])(
  '%s errors inside an HTTP-successful pipeline still fail the operation, with close requested',
  async function failedQuery(code) {
    const { api, pipelines } = fixture({
      response: {
        ...QUERY_RESPONSE,
        results: [
          { type: 'error', error: { code, message: 'Query refused.' } },
          { type: 'ok', response: { type: 'close' } },
        ],
      },
    });
    await expect(
      executeSqliteQuery({ api, connectionId: CONNECTION_ID, sql: 'DELETE FROM users' }),
    ).rejects.toThrow(`${code}: Query refused.`);
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0]?.body).toMatchObject({
      requests: [{ type: 'execute' }, { type: 'close' }],
    });
  },
);

test('HTTP failures report the API error rather than an empty result', async () => {
  const { api } = fixture({
    failure: { status: 409, value: { error: 'The app needs a running deployment.' } },
  });
  await expect(
    executeSqliteQuery({ api, connectionId: CONNECTION_ID, sql: 'SELECT 1' }),
  ).rejects.toThrow('409: The app needs a running deployment.');
});

test('closing failures are surfaced after an otherwise successful query', async () => {
  const { api } = fixture({
    response: {
      ...QUERY_RESPONSE,
      results: [
        QUERY_RESPONSE.results[0]!,
        { type: 'error', error: { message: 'Stream expired.' } },
      ],
    },
  });
  await expect(
    executeSqliteQuery({ api, connectionId: CONNECTION_ID, sql: 'SELECT 1' }),
  ).rejects.toThrow('Stream expired.');
});

test('an incomplete pipeline response cannot be returned as a successful query', async () => {
  const { api } = fixture({ response: { ...QUERY_RESPONSE, results: [] } });
  await expect(
    executeSqliteQuery({ api, connectionId: CONNECTION_ID, sql: 'SELECT 1' }),
  ).rejects.toThrow('unexpected SQLite query response');
});
