import { Type } from '@sinclair/typebox';
import { GuestPathSchema } from '#domain/filesystem.ts';
import {
  AppIdSchema,
  DeploymentIdSchema,
  SqliteQueryIdSchema,
  SqliteSessionIdSchema,
} from '#domain/identifiers.ts';
import {
  SqliteDescribeResultSchema,
  SqliteSqlSchema,
  SqliteStatementResultSchema,
  SqliteStatementSchema,
} from '#domain/sqlite.ts';

const MAX_SERVED_DEPLOYMENTS = 200;
const MAX_ERROR_CODE_LENGTH = 128;
const MAX_ERROR_MESSAGE_LENGTH = 1024;

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
  Type.Object({ status: Type.Literal('executed'), result: SqliteStatementResultSchema }),
  Type.Object({ status: Type.Literal('described'), result: SqliteDescribeResultSchema }),
  Type.Object({ status: Type.Literal('sequenced') }),
  Type.Object({ status: Type.Literal('closed') }),
  Type.Object({
    status: Type.Literal('failed'),
    code: Type.String({ maxLength: MAX_ERROR_CODE_LENGTH }),
    message: Type.String({ maxLength: MAX_ERROR_MESSAGE_LENGTH }),
  }),
]);
export type SqliteOutcome = typeof SqliteOutcomeSchema.static;

export const SqliteQueryResultSchema = Type.Object({
  queryId: SqliteQueryIdSchema,
  outcome: SqliteOutcomeSchema,
});
export type SqliteQueryResult = typeof SqliteQueryResultSchema.static;
