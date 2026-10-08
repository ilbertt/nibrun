import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import type { Value } from '@libsql/client/web';
import {
  groupSqliteForeignKeys,
  SQLITE_FOREIGN_KEY_QUERY,
  sqliteRowReferences,
} from '#lib/foreign-keys.ts';

const SQLITE_MAX_INTEGER = 9223372036854775807n;
const MAX_BYTE = 255;
const SQL_LIKE_TEXT = "x'); DROP TABLE users; --";
const TEXT_WITH_NULL = 'before\0after';

function fixture() {
  const database = new Database(':memory:', { safeIntegers: true });
  database.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO users VALUES (1, 'Ada'), (2, 'Grace'), (9223372036854775807, 'Max');
    CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users);
    CREATE TABLE composite_parent (tenant TEXT, id INTEGER, name TEXT, PRIMARY KEY (tenant, id));
    INSERT INTO composite_parent VALUES ('a', 1, 'match'), ('b', 1, 'other tenant');
    CREATE TABLE composite_child (tenant TEXT, parent_id INTEGER,
      FOREIGN KEY (tenant, parent_id) REFERENCES composite_parent);
    CREATE TABLE text_parent (id TEXT PRIMARY KEY);
    INSERT INTO text_parent VALUES ('O''Brien');
    CREATE TABLE text_child (parent_id TEXT REFERENCES text_parent(id));
    CREATE TABLE blob_parent (id BLOB PRIMARY KEY);
    INSERT INTO blob_parent VALUES (X'00ff01');
    CREATE TABLE blob_child (parent_id BLOB REFERENCES blob_parent(id));
    CREATE TABLE guessed (user_id INTEGER);
    CREATE TABLE different_case (user_id INTEGER, FOREIGN KEY (USER_ID) REFERENCES users(ID));
    CREATE TABLE "parent""table" ("key""value" TEXT PRIMARY KEY);
    CREATE TABLE weird_child (parent_id TEXT REFERENCES "parent""table" ("key""value"));
    CREATE TABLE unresolved (a INTEGER, b INTEGER,
      FOREIGN KEY (a, b) REFERENCES missing_parent);
  `);
  database.query('INSERT INTO text_parent VALUES (?)').run(TEXT_WITH_NULL);
  database.query('INSERT INTO "parent""table" VALUES (?)').run(SQL_LIKE_TEXT);
  return database;
}

function referencesFor({
  database,
  table,
  values,
}: {
  database: Database;
  table: string;
  values: Record<string, Value>;
}) {
  const rows = database.query<Record<string, Value>, [string]>(SQLITE_FOREIGN_KEY_QUERY).all(table);
  return sqliteRowReferences({ foreignKeys: groupSqliteForeignKeys(rows), values });
}

describe('SQLite foreign-key navigation', () => {
  test('resolves implicit primary keys and opens only the referenced row', () => {
    const database = fixture();
    try {
      const [reference] = referencesFor({ database, table: 'orders', values: { user_id: 2n } });
      expect(reference).toMatchObject({
        columnName: 'user_id',
        referencedTable: 'users',
        referencedColumn: 'id',
      });
      expect(database.query(reference!.sql).all()).toEqual([{ id: 2n, name: 'Grace' }]);
    } finally {
      database.close();
    }
  });

  test('uses every column of composite foreign keys in primary-key order', () => {
    const database = fixture();
    try {
      const references = referencesFor({
        database,
        table: 'composite_child',
        values: { tenant: 'a', parent_id: 1n },
      });
      expect(references.map((reference) => reference.columnName)).toEqual(['tenant', 'parent_id']);
      expect(references[0]!.sql).toBe(references[1]!.sql);
      expect(database.query(references[0]!.sql).all()).toEqual([
        { tenant: 'a', id: 1n, name: 'match' },
      ]);
      expect(
        referencesFor({
          database,
          table: 'composite_child',
          values: { tenant: null, parent_id: 1n },
        }),
      ).toEqual([]);
    } finally {
      database.close();
    }
  });

  test('preserves 64-bit integer, quoted text and blob reference values', () => {
    const database = fixture();
    try {
      const [integer] = referencesFor({
        database,
        table: 'orders',
        values: { user_id: SQLITE_MAX_INTEGER },
      });
      expect(database.query(integer!.sql).get()).toEqual({ id: SQLITE_MAX_INTEGER, name: 'Max' });
      const [text] = referencesFor({
        database,
        table: 'text_child',
        values: { parent_id: "O'Brien" },
      });
      expect(database.query(text!.sql).get()).toEqual({ id: "O'Brien" });
      const [blob] = referencesFor({
        database,
        table: 'blob_child',
        values: { parent_id: new Uint8Array([0, MAX_BYTE, 1]).buffer },
      });
      expect(database.query(blob!.sql).get()).toEqual({ id: new Uint8Array([0, MAX_BYTE, 1]) });
    } finally {
      database.close();
    }
  });

  test('quotes identifiers and SQL-like text, including embedded null bytes', () => {
    const database = fixture();
    try {
      const [quoted] = referencesFor({
        database,
        table: 'weird_child',
        values: { parent_id: SQL_LIKE_TEXT },
      });
      expect(database.query(quoted!.sql).get()).toEqual({ 'key"value': SQL_LIKE_TEXT });
      expect(database.query('SELECT count(*) AS total FROM users').get()).toEqual({ total: 3n });
      const [nullByte] = referencesFor({
        database,
        table: 'text_child',
        values: { parent_id: TEXT_WITH_NULL },
      });
      expect(database.query(nullByte!.sql).get()).toEqual({ id: TEXT_WITH_NULL });
      const [caseInsensitive] = referencesFor({
        database,
        table: 'different_case',
        values: { user_id: 1n },
      });
      expect(caseInsensitive?.columnName).toBe('user_id');
      expect(database.query(caseInsensitive!.sql).get()).toEqual({ id: 1n, name: 'Ada' });
    } finally {
      database.close();
    }
  });

  test('does not guess relationships or offer unresolved/null references', () => {
    const database = fixture();
    try {
      expect(referencesFor({ database, table: 'guessed', values: { user_id: 1n } })).toEqual([]);
      expect(referencesFor({ database, table: 'unresolved', values: { a: 1n, b: 2n } })).toEqual(
        [],
      );
      expect(referencesFor({ database, table: 'orders', values: { user_id: null } })).toEqual([]);
      expect(referencesFor({ database, table: 'orders', values: {} })).toEqual([]);
    } finally {
      database.close();
    }
  });
});
