import { Type } from '@sinclair/typebox';

export const SQLITE_MAX_STATEMENT_LENGTH = 65536;
export const SQLITE_MAX_VALUE_LENGTH = 65536;
export const SQLITE_MAX_PARAMETERS = 256;
export const SQLITE_MAX_COLUMNS = 256;
export const SQLITE_MAX_ROWS = 1000;

const BASE64_INPUT_BYTES = 3;
const BASE64_OUTPUT_CHARACTERS = 4;

const IntegerSchema = Type.String({ pattern: '^-?(0|[1-9][0-9]*)$', maxLength: 20 });

// Decimal strings preserve SQLite integers across JSON's narrower numeric range.
export const SqliteValueSchema = Type.Union([
  Type.Object({ type: Type.Literal('null') }),
  Type.Object({ type: Type.Literal('integer'), value: IntegerSchema }),
  Type.Object({ type: Type.Literal('float'), value: Type.Number() }),
  Type.Object({
    type: Type.Literal('text'),
    value: Type.String({ maxLength: SQLITE_MAX_VALUE_LENGTH }),
  }),
  Type.Object({
    type: Type.Literal('blob'),
    base64: Type.String({
      pattern: '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$',
      maxLength: Math.ceil(SQLITE_MAX_VALUE_LENGTH / BASE64_INPUT_BYTES) * BASE64_OUTPUT_CHARACTERS,
    }),
  }),
]);
export type SqliteValue = typeof SqliteValueSchema.static;

export const SqliteSqlSchema = Type.String({ maxLength: SQLITE_MAX_STATEMENT_LENGTH });
export const SqliteStatementSchema = Type.Object({
  sql: SqliteSqlSchema,
  args: Type.Array(SqliteValueSchema, { maxItems: SQLITE_MAX_PARAMETERS }),
  namedArgs: Type.Array(
    Type.Object({ name: Type.String({ maxLength: 256 }), value: SqliteValueSchema }),
    {
      maxItems: SQLITE_MAX_PARAMETERS,
    },
  ),
  wantRows: Type.Boolean(),
});
export type SqliteStatement = typeof SqliteStatementSchema.static;

export const SqliteColumnSchema = Type.Object({
  name: Type.String({ maxLength: SQLITE_MAX_VALUE_LENGTH }),
  declaredType: Type.Optional(Type.String({ maxLength: SQLITE_MAX_VALUE_LENGTH })),
});
export type SqliteColumn = typeof SqliteColumnSchema.static;

export const SqliteStatementResultSchema = Type.Object({
  columns: Type.Array(SqliteColumnSchema, { maxItems: SQLITE_MAX_COLUMNS }),
  rows: Type.Array(Type.Array(SqliteValueSchema, { maxItems: SQLITE_MAX_COLUMNS }), {
    maxItems: SQLITE_MAX_ROWS,
  }),
  affectedRowCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  lastInsertRowid: Type.Optional(IntegerSchema),
});
export type SqliteStatementResult = typeof SqliteStatementResultSchema.static;

export const SqliteDescribeResultSchema = Type.Object({
  parameters: Type.Array(Type.Object({ name: Type.Optional(Type.String({ maxLength: 256 })) }), {
    maxItems: SQLITE_MAX_PARAMETERS,
  }),
  columns: Type.Array(SqliteColumnSchema, { maxItems: SQLITE_MAX_COLUMNS }),
  isExplain: Type.Boolean(),
  isReadonly: Type.Boolean(),
});
export type SqliteDescribeResult = typeof SqliteDescribeResultSchema.static;
