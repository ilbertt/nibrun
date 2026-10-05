import {
  SQLITE_MAX_PARAMETERS,
  SqliteSqlSchema,
  SqliteStatementSchema,
  SqliteValueSchema,
  Value,
} from '@repo/protocol';
import { t } from 'elysia';
import { HranaError } from '#lib/hrana/errors.ts';

const MAX_PIPELINE_REQUESTS = 64;
const MAX_BATCH_STEPS = 256;
const MAX_STRUCTURE_DEPTH = 32;
const MAX_STRUCTURE_NODES = 16_384;
const MAX_BATON_LENGTH = 128;
const MIN_INT32 = -2_147_483_648;
const MAX_INT32 = 2_147_483_647;

const SqlIdSchema = t.Integer({ minimum: MIN_INT32, maximum: MAX_INT32 });
const SqlSchema = SqliteSqlSchema;
const SqlReferenceFields = {
  sql: t.Optional(t.Union([SqlSchema, t.Null()])),
  sql_id: t.Optional(t.Union([SqlIdSchema, t.Null()])),
};

export const HranaStatementSchema = t.Object({
  ...SqlReferenceFields,
  args: t.Optional(t.Array(SqliteValueSchema, { maxItems: SQLITE_MAX_PARAMETERS })),
  named_args: t.Optional(
    t.Array(
      t.Object({
        name: SqliteStatementSchema.properties.namedArgs.items.properties.name,
        value: SqliteValueSchema,
      }),
      { maxItems: SQLITE_MAX_PARAMETERS },
    ),
  ),
  want_rows: t.Optional(t.Boolean()),
});

export type HranaStatement = typeof HranaStatementSchema.static;

const ConditionSchema = t.Recursive(function condition(self) {
  return t.Union([
    t.Object({ type: t.Literal('ok'), step: t.Integer({ minimum: 0, maximum: MAX_BATCH_STEPS }) }),
    t.Object({
      type: t.Literal('error'),
      step: t.Integer({ minimum: 0, maximum: MAX_BATCH_STEPS }),
    }),
    t.Object({ type: t.Literal('not'), cond: self }),
    t.Object({ type: t.Literal('and'), conds: t.Array(self, { maxItems: MAX_BATCH_STEPS }) }),
    t.Object({ type: t.Literal('or'), conds: t.Array(self, { maxItems: MAX_BATCH_STEPS }) }),
  ]);
});

export type HranaCondition = typeof ConditionSchema.static;

const BatchSchema = t.Object({
  steps: t.Array(
    t.Object({
      condition: t.Optional(t.Union([ConditionSchema, t.Null()])),
      stmt: HranaStatementSchema,
    }),
    { maxItems: MAX_BATCH_STEPS },
  ),
});

export type HranaBatch = typeof BatchSchema.static;

const StreamRequestSchema = t.Union([
  t.Object({ type: t.Literal('close') }),
  t.Object({ type: t.Literal('execute'), stmt: HranaStatementSchema }),
  t.Object({ type: t.Literal('batch'), batch: BatchSchema }),
  t.Object({ type: t.Literal('sequence'), ...SqlReferenceFields }),
  t.Object({ type: t.Literal('describe'), ...SqlReferenceFields }),
  t.Object({ type: t.Literal('store_sql'), sql_id: SqlIdSchema, sql: SqlSchema }),
  t.Object({ type: t.Literal('close_sql'), sql_id: SqlIdSchema }),
]);

export const HranaPipelineSchema = t.Object({
  baton: t.Union([t.String({ minLength: 1, maxLength: MAX_BATON_LENGTH }), t.Null()]),
  requests: t.Array(StreamRequestSchema, { maxItems: MAX_PIPELINE_REQUESTS }),
});

export type HranaPipeline = typeof HranaPipelineSchema.static;
export type HranaStreamRequest = HranaPipeline['requests'][number];

export function parseHranaPipeline(body: unknown): HranaPipeline {
  validateStructure(body);
  if (!Value.Check(HranaPipelineSchema, body)) {
    throw new HranaError({ message: 'Invalid Hrana pipeline', code: 'PROTO_ERROR' });
  }
  return body;
}

function validateStructure(body: unknown): void {
  const pending = [{ value: body, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const item = pending.pop()!;
    nodes += 1;
    if (nodes > MAX_STRUCTURE_NODES || item.depth > MAX_STRUCTURE_DEPTH) {
      throw new HranaError({ message: 'Hrana request is too complex', code: 'PROTO_ERROR' });
    }
    if (item.value !== null && typeof item.value === 'object') {
      for (const value of Object.values(item.value)) {
        pending.push({ value, depth: item.depth + 1 });
      }
    }
  }
}
