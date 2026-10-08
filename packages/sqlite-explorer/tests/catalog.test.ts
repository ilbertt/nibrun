import { afterEach, describe, expect, test } from 'bun:test';
import { createSqliteWorkspace } from '#lib/workspace.ts';
import { startDatabaseServer } from '#tests/support/database-server.ts';

const setup = `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users, item TEXT DEFAULT 'notebook');
CREATE INDEX orders_user ON orders(user_id);
CREATE VIEW order_names AS SELECT item FROM orders;
CREATE TABLE "a.b" ("a'column" TEXT, generated TEXT GENERATED ALWAYS AS ("a'column" || '!'));
CREATE TABLE parent (a INTEGER, b TEXT, PRIMARY KEY(a, b));
CREATE TABLE child (x INTEGER, y TEXT, FOREIGN KEY(x, y) REFERENCES parent);`;
const disposables: { close(): void }[] = [];
afterEach(() => {
  for (const disposable of disposables.splice(0)) {
    disposable.close();
  }
});
function openWorkspace() {
  const server = startDatabaseServer(setup);
  const workspace = createSqliteWorkspace({ url: server.url, authToken: '' });
  disposables.push(workspace, server);
  return { workspace, ...workspace.props };
}

describe('LibreDB SQLite catalog adapter', () => {
  test('lists real tables and views with unambiguous paths and counts', async () => {
    const { workspace, onObjectsFetch } = openWorkspace();
    expect(await onObjectsFetch.listContainers(workspace.url)).toEqual([]);
    expect(await onObjectsFetch.countObjects(workspace.url, [])).toEqual({
      table: { count: 5 },
      view: { count: 1 },
    });
    const tables = await onObjectsFetch.listObjects(workspace.url, [], 'table');
    expect(tables).toContainEqual({ name: 'a.b', kind: 'table', path: ['a.b'] });
    expect(await onObjectsFetch.listObjects(workspace.url, [], 'view')).toEqual([
      { name: 'order_names', kind: 'view', path: ['order_names'] },
    ]);
  });
  test('provides columns, indexes and foreign keys for the workspace and ER diagram', async () => {
    const { workspace, onSchemaFetch } = openWorkspace();
    const schema = await onSchemaFetch(workspace.url);
    const orders = schema.find((object) => object.name === 'orders');
    expect(orders?.columns).toContainEqual({
      name: 'id',
      type: 'INTEGER',
      nullable: true,
      isPrimary: true,
    });
    expect(orders?.indexes).toEqual([{ name: 'orders_user', unique: false, columns: ['user_id'] }]);
    expect(orders?.foreignKeys).toEqual([
      { columnName: 'user_id', referencedTable: 'users', referencedColumn: 'id' },
    ]);
    expect(schema.find((object) => object.name === 'child')?.foreignKeys).toEqual([
      { columnName: 'x', referencedTable: 'parent', referencedColumn: 'a' },
      { columnName: 'y', referencedTable: 'parent', referencedColumn: 'b' },
    ]);
    expect(
      schema.find((object) => object.name === 'a.b')?.columns.map((column) => column.name),
    ).toEqual(["a'column", 'generated']);
  });
  test('unknown objects fail instead of producing an empty schema', async () => {
    const { workspace, onObjectsFetch } = openWorkspace();
    await expect(
      onObjectsFetch.describeObject?.(workspace.url, ['missing'], 'table'),
    ).rejects.toThrow('was not found');
  });
});
