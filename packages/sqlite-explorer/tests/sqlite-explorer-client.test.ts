import { afterEach, describe, expect, test } from 'bun:test';
import { executeSqliteQuery } from '#lib/client.ts';
import { TABLE_PAGE_SIZE } from '#lib/query.ts';

const servers: ReturnType<typeof Bun.serve>[] = [];
const RESULT_ROW_COUNT = TABLE_PAGE_SIZE + 1;

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
});

function startDatabase(error: { code: string; message: string } | undefined) {
  const statements: string[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as {
        requests: { type: string; stmt: { sql: string } | undefined }[];
      };
      const results = body.requests.map((entry) => {
        if (entry.type !== 'execute' || !entry.stmt) {
          return { type: 'ok', response: { type: entry.type } };
        }
        statements.push(entry.stmt.sql);
        return error
          ? { type: 'error', error }
          : {
              type: 'ok',
              response: {
                type: 'execute',
                result: {
                  cols: [{ name: 'id', decltype: 'INTEGER' }],
                  rows: Array.from(Array.from({ length: RESULT_ROW_COUNT }).keys(), (index) => [
                    { type: 'integer', value: String(index + 1) },
                  ]),
                  affected_row_count: 0,
                  last_insert_rowid: null,
                },
              },
            };
      });
      return Response.json({ baton: null, base_url: null, results });
    },
  });
  servers.push(server);
  return { statements, url: server.url.href };
}

describe('SQLite explorer client', () => {
  test('executes editor SQL unchanged and retains every returned row without pagination', async () => {
    const database = startDatabase(undefined);
    const sql = '  SELECT id FROM users ORDER BY id; -- keep this comment\n';
    const response = await executeSqliteQuery({
      url: database.url,
      authToken: '',
      sql,
      offset: undefined,
      table: undefined,
    });
    expect(database.statements).toEqual([sql]);
    expect(response.error).toBeUndefined();
    expect(response.result?.rows).toHaveLength(RESULT_ROW_COUNT);
    expect(response.result?.rows.at(-1)).toEqual({ id: RESULT_ROW_COUNT });
    expect(response.result?.rowCount).toBe(RESULT_ROW_COUNT);
    expect(response.result?.pagination).toBeUndefined();
  });

  test('retains pagination for table browsing', async () => {
    const database = startDatabase(undefined);
    const sql = 'SELECT * FROM "users"';
    const response = await executeSqliteQuery({
      url: database.url,
      authToken: '',
      sql,
      offset: TABLE_PAGE_SIZE,
      table: undefined,
    });
    expect(database.statements).toEqual([
      `SELECT * FROM (${sql}) LIMIT ${TABLE_PAGE_SIZE + 1} OFFSET ${TABLE_PAGE_SIZE}`,
    ]);
    expect(response.result?.rows).toHaveLength(TABLE_PAGE_SIZE);
    expect(response.result?.pagination).toMatchObject({
      offset: TABLE_PAGE_SIZE,
      hasMore: true,
    });
  });

  test('sends writes to the backend and preserves its read-only error', async () => {
    const error = { code: 'SQLITE_READONLY', message: 'attempt to write a readonly database' };
    const database = startDatabase(error);
    const sql = "INSERT INTO users (name) VALUES ('Ada')";
    const response = await executeSqliteQuery({
      url: database.url,
      authToken: '',
      sql,
      offset: undefined,
      table: undefined,
    });
    expect(database.statements).toEqual([sql]);
    expect(response.error).toBe(`${error.code}: ${error.message}`);
    expect(response.result).toBeUndefined();
  });
});
