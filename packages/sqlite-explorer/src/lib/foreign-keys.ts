import type { ForeignKeySchema } from '@libredb/studio/types';
import type { Value } from '@libsql/client/web';

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
