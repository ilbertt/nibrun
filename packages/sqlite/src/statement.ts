import { Type } from '@sinclair/typebox';
import { HranaStmtSchema } from '#hrana.ts';
import { SQLITE_MAX_STATEMENT_LENGTH } from '#limits.ts';

export const SqliteSqlSchema = Type.String({ maxLength: SQLITE_MAX_STATEMENT_LENGTH });
export const SqliteStatementSchema = Type.Object({
  ...Type.Required(Type.Pick(HranaStmtSchema, ['sql', 'args', 'named_args', 'want_rows']))
    .properties,
  sql: SqliteSqlSchema,
});
export type SqliteStatement = typeof SqliteStatementSchema.static;
