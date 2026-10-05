import type { SqliteStatement } from '@repo/protocol';
import { HranaError } from '#lib/hrana/errors.ts';
import type { HranaStatement } from '#lib/hrana/schema.ts';

type SqlReference = Pick<HranaStatement, 'sql' | 'sql_id'>;

export function resolveHranaSql({
  reference,
  storedSql,
}: {
  reference: SqlReference;
  storedSql: ReadonlyMap<number, string>;
}): string {
  const hasText = reference.sql !== undefined && reference.sql !== null;
  const hasId = reference.sql_id !== undefined && reference.sql_id !== null;
  if (hasText === hasId) {
    throw new HranaError({ message: 'Specify exactly one of sql and sql_id', code: 'PROTO_ERROR' });
  }
  if (hasText) {
    return reference.sql!;
  }
  const sql = storedSql.get(reference.sql_id!);
  if (sql === undefined) {
    throw new HranaError({
      message: 'SQL text is not stored on this stream',
      code: 'SQL_NOT_FOUND',
    });
  }
  return sql;
}

export function hranaStatement({
  statement,
  storedSql,
}: {
  statement: HranaStatement;
  storedSql: ReadonlyMap<number, string>;
}): SqliteStatement {
  return {
    sql: resolveHranaSql({ reference: statement, storedSql }),
    args: statement.args ?? [],
    namedArgs: statement.named_args ?? [],
    wantRows: statement.want_rows ?? true,
  };
}
