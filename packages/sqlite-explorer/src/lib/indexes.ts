import type { IndexSchema } from '@libredb/studio/types';
import type { SqliteDatabase } from '#lib/client.ts';

export async function readSqliteIndexes({
  database,
  name,
}: {
  database: SqliteDatabase;
  name: string;
}): Promise<IndexSchema[]> {
  const result = await database.execute({
    sql: 'SELECT il.name, il."unique" AS is_unique, ii.name AS column_name FROM pragma_index_list(?) AS il JOIN pragma_index_info(il.name) AS ii ORDER BY il.seq, ii.seqno',
    args: [name],
  });
  const indexes = new Map<string, IndexSchema>();
  for (const row of result.rows) {
    const indexName = String(row.name);
    const index = indexes.get(indexName) ?? {
      name: indexName,
      unique: Number(row.is_unique) === 1,
      columns: [],
    };
    if (row.column_name !== null) {
      index.columns.push(String(row.column_name));
    }
    indexes.set(indexName, index);
  }
  return Array.from(indexes.values());
}
