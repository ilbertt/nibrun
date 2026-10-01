import { Type } from '@sinclair/typebox';
import { CronListingSchema, CronTableSchema } from '#domain/cron.ts';
import { CronQueryIdSchema } from '#domain/identifiers.ts';

const MAX_SERVED_DEPLOYMENTS = 200;
const MAX_QUERY_MESSAGE_LENGTH = 512;

export const CronQueryRequestSchema = Type.Object({
  servedDeployments: Type.Array(Type.Pick(CronTableSchema, ['appId', 'deploymentId']), {
    maxItems: MAX_SERVED_DEPLOYMENTS,
  }),
});

export type CronQueryRequest = typeof CronQueryRequestSchema.static;

export const CronQuerySchema = Type.Composite([
  Type.Pick(CronTableSchema, ['appId', 'deploymentId']),
  Type.Object({ queryId: CronQueryIdSchema }),
]);

export type CronQuery = typeof CronQuerySchema.static;

export const CronQueryResponseSchema = Type.Union([
  Type.Object({ result: Type.Literal('none') }),
  Type.Object({ result: Type.Literal('query'), query: CronQuerySchema }),
]);

export type CronQueryResponse = typeof CronQueryResponseSchema.static;

export const CronQueryResultSchema = Type.Object({
  queryId: CronQueryIdSchema,
  outcome: Type.Union([
    Type.Object({ status: Type.Literal('listed'), listing: CronListingSchema }),
    Type.Object({
      status: Type.Literal('failed'),
      message: Type.String({ maxLength: MAX_QUERY_MESSAGE_LENGTH }),
    }),
  ]),
});

export type CronQueryResult = typeof CronQueryResultSchema.static;
