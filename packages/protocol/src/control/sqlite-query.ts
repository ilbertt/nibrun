import { Type } from '@sinclair/typebox';
import { GuestPathSchema } from '#domain/filesystem.ts';
import {
  HranaDescribeResultSchema,
  HranaStmtResultSchema,
  HranaStmtSchema,
} from '#domain/hrana.ts';
import {
  AppIdSchema,
  DeploymentIdSchema,
  SqliteQueryIdSchema,
  SqliteSessionIdSchema,
} from '#domain/identifiers.ts';
import { SQLITE_MAX_STATEMENT_LENGTH } from '#domain/sqlite-limits.ts';

const SqliteSqlSchema = Type.String({ maxLength: SQLITE_MAX_STATEMENT_LENGTH });
export const SqliteStatementSchema = Type.Object({
  ...Type.Required(Type.Pick(HranaStmtSchema, ['sql', 'args', 'named_args', 'want_rows']))
    .properties,
  sql: SqliteSqlSchema,
});
export type SqliteStatement = typeof SqliteStatementSchema.static;

const MAX_SERVED_DEPLOYMENTS = 200;
const MAX_ERROR_CODE_LENGTH = 128;
export const SQLITE_MAX_ERROR_MESSAGE_LENGTH = 1024;

export const SqliteOperationSchema = Type.Union([
  Type.Object({ type: Type.Literal('open'), path: GuestPathSchema }),
  Type.Object({ type: Type.Literal('execute'), statement: SqliteStatementSchema }),
  Type.Object({ type: Type.Literal('describe'), sql: SqliteSqlSchema }),
  Type.Object({ type: Type.Literal('sequence'), sql: SqliteSqlSchema }),
  Type.Object({ type: Type.Literal('close') }),
]);
export type SqliteOperation = typeof SqliteOperationSchema.static;

export const SqliteQuerySchema = Type.Object({
  queryId: SqliteQueryIdSchema,
  appId: AppIdSchema,
  deploymentId: DeploymentIdSchema,
  sessionId: SqliteSessionIdSchema,
  operation: SqliteOperationSchema,
});
export type SqliteQuery = typeof SqliteQuerySchema.static;

export const SqliteQueryRequestSchema = Type.Object({
  servedDeployments: Type.Array(Type.Pick(SqliteQuerySchema, ['appId', 'deploymentId']), {
    maxItems: MAX_SERVED_DEPLOYMENTS,
  }),
});
export type SqliteQueryRequest = typeof SqliteQueryRequestSchema.static;

export const SqliteQueryResponseSchema = Type.Union([
  Type.Object({ result: Type.Literal('none') }),
  Type.Object({ result: Type.Literal('query'), query: SqliteQuerySchema }),
]);
export type SqliteQueryResponse = typeof SqliteQueryResponseSchema.static;

export const SqliteOutcomeSchema = Type.Union([
  Type.Object({ status: Type.Literal('opened') }),
  Type.Object({ status: Type.Literal('executed'), result: HranaStmtResultSchema }),
  Type.Object({ status: Type.Literal('described'), result: HranaDescribeResultSchema }),
  Type.Object({ status: Type.Literal('sequenced') }),
  Type.Object({ status: Type.Literal('closed') }),
  Type.Object({
    status: Type.Literal('failed'),
    code: Type.String({ maxLength: MAX_ERROR_CODE_LENGTH }),
    message: Type.String({ maxLength: SQLITE_MAX_ERROR_MESSAGE_LENGTH }),
  }),
]);
export type SqliteOutcome = typeof SqliteOutcomeSchema.static;

export const SqliteQueryResultSchema = Type.Object({
  queryId: SqliteQueryIdSchema,
  outcome: SqliteOutcomeSchema,
});
export type SqliteQueryResult = typeof SqliteQueryResultSchema.static;
