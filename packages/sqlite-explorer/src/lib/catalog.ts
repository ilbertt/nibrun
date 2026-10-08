import type { DatabaseObject, DetailedObject, ObjectDetail } from '@libredb/studio/types';
import { SQLITE_OBJECT_KINDS } from '#lib/capabilities.ts';
import type { SqliteDatabase } from '#lib/client.ts';
import { groupSqliteForeignKeys, SQLITE_FOREIGN_KEY_QUERY } from '#lib/foreign-keys.ts';
import { readSqliteIndexes } from '#lib/indexes.ts';

export async function listSqliteObjects(database: SqliteDatabase): Promise<DatabaseObject[]> {
  const kinds = SQLITE_OBJECT_KINDS.map((kind) => kind.id);
  const result = await database.execute({
    sql: `SELECT name, type FROM sqlite_schema WHERE type IN (${kinds.map(() => '?').join(', ')}) AND name NOT GLOB 'sqlite_*' ORDER BY name`,
    args: kinds,
  });
  return result.rows.map((row) => ({
    name: String(row.name),
    kind: String(row.type),
    path: [String(row.name)],
  }));
}

export async function describeSqliteObject({
  database,
  path,
}: {
  database: SqliteDatabase;
  path: readonly string[];
}): Promise<ObjectDetail> {
  if (path.length !== 1 || !path[0]) {
    throw new Error('Expected a SQLite table or view name.');
  }
  const name = path[0];
  const [columns, foreignKeys, indexes] = await Promise.all([
    database.execute({
      sql: 'SELECT name, type, "notnull", pk, dflt_value FROM pragma_table_xinfo(?) ORDER BY cid',
      args: [name],
    }),
    database.execute({ sql: SQLITE_FOREIGN_KEY_QUERY, args: [name] }),
    readSqliteIndexes({ database, name }),
  ]);
  if (columns.rows.length === 0) {
    throw new Error(`SQLite object ${name} was not found.`);
  }
  return {
    path,
    columns: columns.rows.map((row) => ({
      name: String(row.name),
      type: String(row.type),
      nullable: Number(row.notnull) === 0,
      isPrimary: Number(row.pk) > 0,
      ...(row.dflt_value === null ? {} : { defaultExpression: String(row.dflt_value) }),
    })),
    foreignKeys: groupSqliteForeignKeys(foreignKeys.rows).flat(),
    indexes,
  };
}

export async function readSqliteSchema(database: SqliteDatabase): Promise<DetailedObject[]> {
  const objects = await listSqliteObjects(database);
  return Promise.all(
    objects.map(async (object) => ({
      ...object,
      ...(await describeSqliteObject({ database, path: object.path })),
    })),
  );
}
