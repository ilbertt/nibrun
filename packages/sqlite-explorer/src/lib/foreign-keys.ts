import type { ForeignKeySchema } from '@libredb/studio/types';
import type { Value } from '@libsql/client/web';
import { sqliteIdentifier, tableQuery } from '#lib/query.ts';
import { sqliteValueLiteral } from '#lib/values.ts';

export type SqliteRowReference = ForeignKeySchema & { sql: string };

export const SQLITE_FOREIGN_KEY_QUERY = `
SELECT fk.id, source.name AS columnName, fk."table" AS referencedTable,
       COALESCE(fk."to", pk.name) AS referencedColumn
FROM pragma_foreign_key_list(?1) AS fk
JOIN pragma_table_info(?1) AS source ON source.name = fk."from" COLLATE NOCASE
LEFT JOIN pragma_table_info(fk."table") AS pk
  ON fk."to" IS NULL AND pk.pk = fk.seq + 1
ORDER BY fk.id, fk.seq`;

export function groupSqliteForeignKeys(
  rows: readonly Record<string, Value>[],
): ForeignKeySchema[][] {
  const groups = new Map<string, ForeignKeySchema[]>();
  const unresolved = new Set<string>();
  for (const row of rows) {
    const id = String(row.id);
    if (row.referencedColumn === null) {
      unresolved.add(id);
      continue;
    }
    const group = groups.get(id) ?? [];
    group.push({
      columnName: String(row.columnName),
      referencedTable: String(row.referencedTable),
      referencedColumn: String(row.referencedColumn),
    });
    groups.set(id, group);
  }
  return Array.from(groups.entries())
    .filter(([id]) => !unresolved.has(id))
    .map(([, group]) => group);
}

export function sqliteRowReferences({
  foreignKeys,
  values,
}: {
  foreignKeys: ForeignKeySchema[][];
  values: Readonly<Record<string, Value>>;
}): SqliteRowReference[] {
  const references = new Map<string, SqliteRowReference>();
  for (const columns of foreignKeys) {
    const sql = referencedRowQuery({ columns, values });
    if (sql === undefined) {
      continue;
    }
    for (const column of columns) {
      references.set(JSON.stringify([column.columnName, sql]), { ...column, sql });
    }
  }
  return Array.from(references.values());
}

// The destination query stays editable and runnable without hidden parameter bindings.
function referencedRowQuery({
  columns,
  values,
}: {
  columns: ForeignKeySchema[];
  values: Readonly<Record<string, Value>>;
}): string | undefined {
  const predicates: string[] = [];
  for (const column of columns) {
    const value = Object.hasOwn(values, column.columnName) ? values[column.columnName] : undefined;
    if (value === undefined || value === null) {
      return undefined;
    }
    predicates.push(`${sqliteIdentifier(column.referencedColumn)} = ${sqliteValueLiteral(value)}`);
  }
  return columns[0]
    ? `${tableQuery(columns[0].referencedTable)} WHERE ${predicates.join(' AND ')}`
    : undefined;
}
