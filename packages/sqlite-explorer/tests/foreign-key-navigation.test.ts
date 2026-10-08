import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { createSqliteWorkspace } from '#lib/workspace.ts';
import { startDatabaseServer } from '#tests/support/database-server.ts';

// The private module is shipped by the pinned Bun patch, rather than a second implementation here.
const { sqliteForeignKeyLinks, sqliteReferenceQuery, referencedRowTab } = await import(
  new URL('../node_modules/@libredb/studio/dist/sqlite-foreign-key-navigation.mjs', import.meta.url)
    .href
);
const MAX_SQLITE_INTEGER = 9223372036854775807n;
const connectionId = 'test-connection';
const query = 'SELECT * FROM "orders"';
const origin = { connectionId, path: ['orders'], query };
const disposables: { close(): void }[] = [];
afterEach(() => {
  for (const disposable of disposables.splice(0)) {
    disposable.close();
  }
});

async function readSchema() {
  const server = startDatabaseServer(`CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users);
    CREATE TABLE parent (a INTEGER, b INTEGER, PRIMARY KEY(a, b));
    CREATE TABLE child (x INTEGER, y INTEGER, FOREIGN KEY(x, y) REFERENCES parent);
    CREATE TABLE blob_parent (id BLOB PRIMARY KEY);
    CREATE TABLE blob_child (value BLOB REFERENCES blob_parent);`);
  const workspace = createSqliteWorkspace({ url: server.url, authToken: '' });
  disposables.push(workspace, server);
  return await workspace.props.onSchemaFetch(workspace.url);
}

describe('patched LibreDB FK navigation', () => {
  test('uses catalog metadata only for the exact query and connection of a table preview', async () => {
    const schema = await readSchema();
    const input = { type: 'sqlite', connectionId, origin, query, schema };
    const links = sqliteForeignKeyLinks(input);
    expect(links.get('user_id')).toEqual({ path: ['users'], table: 'users', column: 'id' });
    expect(
      sqliteForeignKeyLinks({ ...input, query: 'SELECT user_id AS id FROM orders' }).size,
    ).toBe(0);
    expect(sqliteForeignKeyLinks({ ...input, connectionId: 'other' }).size).toBe(0);
    expect(sqliteForeignKeyLinks({ ...input, origin: undefined }).size).toBe(0);
    expect(sqliteForeignKeyLinks({ ...input, type: 'postgres' }).size).toBe(0);
  });
  test('omits compound constraints and blob keys instead of guessing a reference', async () => {
    const schema = await readSchema();
    for (const name of ['child', 'blob_child']) {
      const links = sqliteForeignKeyLinks({
        type: 'sqlite',
        connectionId,
        query,
        schema,
        origin: { ...origin, path: [name] },
      });
      expect(links.size).toBe(0);
    }
  });
  test('preserves quotes, Unicode and embedded NULs in referenced text keys', () => {
    const database = new Database(':memory:');
    disposables.push(database);
    database.exec('CREATE TABLE "a""table" ("a""key" TEXT PRIMARY KEY)');
    const link = { table: 'a"table', column: 'a"key', path: ['a"table'] };
    for (const value of ["'; DROP TABLE users; --", 'a\0b', '用户']) {
      database.query('INSERT INTO "a""table" VALUES (?)').run(value);
      const sql = sqliteReferenceQuery({ link, value });
      expect(database.query(sql).get()).toEqual({ 'a"key': value });
    }
    expect(sqliteReferenceQuery({ link, value: null })).toBeUndefined();
    expect(sqliteReferenceQuery({ link, value: Number.POSITIVE_INFINITY })).toBeUndefined();
  });
  test('keeps exact integer keys and the referenced table origin in the new tab', () => {
    const database = new Database(':memory:', { safeIntegers: true });
    disposables.push(database);
    database.exec(
      `CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(${MAX_SQLITE_INTEGER}), (1)`,
    );
    const link = { table: 'users', column: 'id', path: ['users'] };
    for (const value of [String(MAX_SQLITE_INTEGER), MAX_SQLITE_INTEGER, 1]) {
      const sql = sqliteReferenceQuery({ link, value });
      expect(database.query(sql).values()[0]?.[0]).toBe(BigInt(value));
      const tab = referencedRowTab({ id: 'new-tab', connectionId, link, query: sql });
      expect(tab.origin).toEqual({ connectionId, path: ['users'], query: sql });
      expect(tab.query).toBe(sql);
    }
  });
});
