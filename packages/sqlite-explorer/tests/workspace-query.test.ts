import { afterEach, describe, expect, test } from 'bun:test';
import { createSqliteWorkspace } from '#lib/workspace.ts';
import { startDatabaseServer } from '#tests/support/database-server.ts';

const ROW_COUNT = 501;
const PAGE_SIZE = 50;

const setup = `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
WITH RECURSIVE numbers(id) AS (VALUES(1) UNION ALL SELECT id + 1 FROM numbers WHERE id < ${ROW_COUNT})
INSERT INTO users SELECT id, 'User ' || id FROM numbers;`;
const disposables: { close(): void }[] = [];
afterEach(() => {
  for (const disposable of disposables.splice(0)) {
    disposable.close();
  }
});
function openWorkspace(sql: string) {
  const server = startDatabaseServer(sql);
  const workspace = createSqliteWorkspace({ url: server.url, authToken: 'test-token' });
  disposables.push(workspace, server);
  return { server, workspace, ...workspace.props };
}

describe('LibreDB query adapter', () => {
  test('sends SQL editor queries unchanged and returns all rows without pagination', async () => {
    const { server, workspace, onQueryExecute } = openWorkspace(setup);
    const sql = '  SELECT id FROM users ORDER BY id; -- keep the comment\n';
    const result = await onQueryExecute(workspace.url, sql);
    expect(server.statements).toEqual([sql]);
    expect(result.rows).toHaveLength(ROW_COUNT);
    expect(result.rows.at(-1)).toEqual({ id: ROW_COUNT });
    expect(result.pagination).toBeUndefined();
    expect(server.headers[0]?.get('authorization')).toBe('Bearer test-token');
    expect(server.headers[0]?.has('cookie')).toBe(false);
    expect(JSON.stringify(workspace.props)).not.toContain('test-token');
  });
  test('pages table previews at the requested limit and offset', async () => {
    const { workspace, onQueryExecute } = openWorkspace(setup);
    const first = await onQueryExecute(workspace.url, 'SELECT * FROM users ORDER BY id', {
      limit: PAGE_SIZE,
    });
    const second = await onQueryExecute(workspace.url, 'SELECT * FROM users ORDER BY id', {
      limit: PAGE_SIZE,
      offset: PAGE_SIZE,
    });
    expect(first.rows).toHaveLength(PAGE_SIZE);
    expect(first.pagination?.hasMore).toBe(true);
    expect(second.rows[0]?.id).toBe(PAGE_SIZE + 1);
    const last = await onQueryExecute(workspace.url, 'SELECT * FROM users ORDER BY id', {
      limit: PAGE_SIZE,
      offset: ROW_COUNT - 1,
    });
    expect(last.rows).toEqual([{ id: ROW_COUNT, name: `User ${ROW_COUNT}` }]);
    expect(last.pagination?.hasMore).toBe(false);
  });
  test('relays native read-only and syntax errors without wrapping writes', async () => {
    const { workspace, server, onQueryExecute } = openWorkspace(`${setup} PRAGMA query_only = ON;`);
    const sql = "INSERT INTO users (name) VALUES ('Ada')";
    await expect(onQueryExecute(workspace.url, sql)).rejects.toThrow(
      'SQLITE_READONLY: attempt to write a readonly database',
    );
    expect(server.statements).toEqual([sql]);
    await expect(onQueryExecute(workspace.url, 'SELECT FROM users')).rejects.toThrow(
      'syntax error',
    );
  });
  test('retains large integers, blobs, NULL and column types', async () => {
    const { workspace, onQueryExecute } = openWorkspace(
      `CREATE TABLE typed (big INTEGER, binary_value BLOB, text_value TEXT, optional_value TEXT); INSERT INTO typed VALUES (9223372036854775807, X'00ff01', CAST(X'610062' AS TEXT), NULL);`,
    );
    const result = await onQueryExecute(workspace.url, 'SELECT * FROM typed');
    expect(result.rows).toEqual([
      {
        big: '9223372036854775807',
        binary_value: '0x00ff01',
        text_value: 'a\0b',
        optional_value: null,
      },
    ]);
    expect(result.columns).toContainEqual({ name: 'big', type: 'INTEGER' });
  });
});
