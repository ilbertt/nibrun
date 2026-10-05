// Manually adapted from the MIT-licensed Hrana wire declarations:
// https://github.com/tursodatabase/libsql/blob/d6c75af6353bb1c34985399608e37cd272a35aa1/docs/HRANA_1_SPEC.md
// https://github.com/tursodatabase/libsql/blob/d6c75af6353bb1c34985399608e37cd272a35aa1/docs/HRANA_2_SPEC.md
// https://github.com/tursodatabase/libsql/blob/d6c75af6353bb1c34985399608e37cd272a35aa1/docs/HTTP_V2_SPEC.md
// Provenance and adaptations: ../vendor/hrana-v2/README.md
import { Type } from '@sinclair/typebox';

export const HranaInt32Schema = Type.Number({ $id: 'HranaInt32Schema' });

export const HranaCloseStreamReqSchema = Type.Object(
  {
    type: Type.Literal('close'),
  },
  { $id: 'HranaCloseStreamReqSchema' },
);

export const HranaValueSchema = Type.Union(
  [
    Type.Object({
      type: Type.Literal('null'),
    }),
    Type.Object({
      type: Type.Literal('integer'),
      value: Type.String(),
    }),
    Type.Object({
      type: Type.Literal('float'),
      value: Type.Number(),
    }),
    Type.Object({
      type: Type.Literal('text'),
      value: Type.String(),
    }),
    Type.Object({
      type: Type.Literal('blob'),
      base64: Type.String(),
    }),
  ],
  { $id: 'HranaValueSchema' },
);

export const HranaNamedArgSchema = Type.Object(
  {
    name: Type.String(),
    value: HranaValueSchema,
  },
  { $id: 'HranaNamedArgSchema' },
);

export const HranaStmtSchema = Type.Object(
  {
    sql: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    sql_id: Type.Optional(Type.Union([HranaInt32Schema, Type.Null()])),
    args: Type.Optional(Type.Array(HranaValueSchema)),
    named_args: Type.Optional(Type.Array(HranaNamedArgSchema)),
    want_rows: Type.Optional(Type.Boolean()),
  },
  { $id: 'HranaStmtSchema' },
);

export const HranaExecuteStreamReqSchema = Type.Object(
  {
    type: Type.Literal('execute'),
    stmt: HranaStmtSchema,
  },
  { $id: 'HranaExecuteStreamReqSchema' },
);

export const HranaBatchCondSchema = Type.Recursive(
  function batchCondition(self) {
    return Type.Union([
      Type.Object({
        type: Type.Literal('ok'),
        step: HranaInt32Schema,
      }),
      Type.Object({
        type: Type.Literal('error'),
        step: HranaInt32Schema,
      }),
      Type.Object({
        type: Type.Literal('not'),
        cond: self,
      }),
      Type.Object({
        type: Type.Literal('and'),
        conds: Type.Array(self),
      }),
      Type.Object({
        type: Type.Literal('or'),
        conds: Type.Array(self),
      }),
    ]);
  },
  { $id: 'HranaBatchCondSchema' },
);

export const HranaBatchStepSchema = Type.Object(
  {
    condition: Type.Optional(Type.Union([HranaBatchCondSchema, Type.Null()])),
    stmt: HranaStmtSchema,
  },
  { $id: 'HranaBatchStepSchema' },
);

export const HranaBatchSchema = Type.Object(
  {
    steps: Type.Array(HranaBatchStepSchema),
  },
  { $id: 'HranaBatchSchema' },
);

export const HranaBatchStreamReqSchema = Type.Object(
  {
    type: Type.Literal('batch'),
    batch: HranaBatchSchema,
  },
  { $id: 'HranaBatchStreamReqSchema' },
);

export const HranaSequenceStreamReqSchema = Type.Object(
  {
    type: Type.Literal('sequence'),
    sql: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    sql_id: Type.Optional(Type.Union([HranaInt32Schema, Type.Null()])),
  },
  { $id: 'HranaSequenceStreamReqSchema' },
);

export const HranaDescribeStreamReqSchema = Type.Object(
  {
    type: Type.Literal('describe'),
    sql: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    sql_id: Type.Optional(Type.Union([HranaInt32Schema, Type.Null()])),
  },
  { $id: 'HranaDescribeStreamReqSchema' },
);

export const HranaStoreSqlStreamReqSchema = Type.Object(
  {
    type: Type.Literal('store_sql'),
    sql_id: HranaInt32Schema,
    sql: Type.String(),
  },
  { $id: 'HranaStoreSqlStreamReqSchema' },
);

export const HranaCloseSqlStreamReqSchema = Type.Object(
  {
    type: Type.Literal('close_sql'),
    sql_id: HranaInt32Schema,
  },
  { $id: 'HranaCloseSqlStreamReqSchema' },
);

export const HranaStreamRequestSchema = Type.Union(
  [
    HranaCloseStreamReqSchema,
    HranaExecuteStreamReqSchema,
    HranaBatchStreamReqSchema,
    HranaSequenceStreamReqSchema,
    HranaDescribeStreamReqSchema,
    HranaStoreSqlStreamReqSchema,
    HranaCloseSqlStreamReqSchema,
  ],
  { $id: 'HranaStreamRequestSchema' },
);

export const HranaPipelineReqBodySchema = Type.Object(
  {
    baton: Type.Union([Type.String(), Type.Null()]),
    requests: Type.Array(HranaStreamRequestSchema),
  },
  { $id: 'HranaPipelineReqBodySchema' },
);

export const HranaCloseStreamRespSchema = Type.Object(
  {
    type: Type.Literal('close'),
  },
  { $id: 'HranaCloseStreamRespSchema' },
);

export const HranaColSchema = Type.Object(
  {
    name: Type.Union([Type.String(), Type.Null()]),
    decltype: Type.Union([Type.String(), Type.Null()]),
  },
  { $id: 'HranaColSchema' },
);

export const HranaStmtResultSchema = Type.Object(
  {
    cols: Type.Array(HranaColSchema),
    rows: Type.Array(Type.Array(HranaValueSchema)),
    affected_row_count: HranaInt32Schema,
    last_insert_rowid: Type.Union([Type.String(), Type.Null()]),
  },
  { $id: 'HranaStmtResultSchema' },
);

export const HranaExecuteStreamRespSchema = Type.Object(
  {
    type: Type.Literal('execute'),
    result: HranaStmtResultSchema,
  },
  { $id: 'HranaExecuteStreamRespSchema' },
);

export const HranaErrorSchema = Type.Object(
  {
    message: Type.String(),
    code: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  },
  { $id: 'HranaErrorSchema' },
);

export const HranaBatchResultSchema = Type.Object(
  {
    step_results: Type.Array(Type.Union([HranaStmtResultSchema, Type.Null()])),
    step_errors: Type.Array(Type.Union([HranaErrorSchema, Type.Null()])),
  },
  { $id: 'HranaBatchResultSchema' },
);

export const HranaBatchStreamRespSchema = Type.Object(
  {
    type: Type.Literal('batch'),
    result: HranaBatchResultSchema,
  },
  { $id: 'HranaBatchStreamRespSchema' },
);

export const HranaSequenceStreamRespSchema = Type.Object(
  {
    type: Type.Literal('sequence'),
  },
  { $id: 'HranaSequenceStreamRespSchema' },
);

export const HranaDescribeParamSchema = Type.Object(
  {
    name: Type.Union([Type.String(), Type.Null()]),
  },
  { $id: 'HranaDescribeParamSchema' },
);

export const HranaDescribeColSchema = Type.Object(
  {
    name: Type.String(),
    decltype: Type.Union([Type.String(), Type.Null()]),
  },
  { $id: 'HranaDescribeColSchema' },
);

export const HranaDescribeResultSchema = Type.Object(
  {
    params: Type.Array(HranaDescribeParamSchema),
    cols: Type.Array(HranaDescribeColSchema),
    is_explain: Type.Boolean(),
    is_readonly: Type.Boolean(),
  },
  { $id: 'HranaDescribeResultSchema' },
);

export const HranaDescribeStreamRespSchema = Type.Object(
  {
    type: Type.Literal('describe'),
    result: HranaDescribeResultSchema,
  },
  { $id: 'HranaDescribeStreamRespSchema' },
);

export const HranaStoreSqlStreamRespSchema = Type.Object(
  {
    type: Type.Literal('store_sql'),
  },
  { $id: 'HranaStoreSqlStreamRespSchema' },
);

export const HranaCloseSqlStreamRespSchema = Type.Object(
  {
    type: Type.Literal('close_sql'),
  },
  { $id: 'HranaCloseSqlStreamRespSchema' },
);

export const HranaStreamResponseSchema = Type.Union(
  [
    HranaCloseStreamRespSchema,
    HranaExecuteStreamRespSchema,
    HranaBatchStreamRespSchema,
    HranaSequenceStreamRespSchema,
    HranaDescribeStreamRespSchema,
    HranaStoreSqlStreamRespSchema,
    HranaCloseSqlStreamRespSchema,
  ],
  { $id: 'HranaStreamResponseSchema' },
);

export const HranaStreamResultOkSchema = Type.Object(
  {
    type: Type.Literal('ok'),
    response: HranaStreamResponseSchema,
  },
  { $id: 'HranaStreamResultOkSchema' },
);

export const HranaStreamResultErrorSchema = Type.Object(
  {
    type: Type.Literal('error'),
    error: HranaErrorSchema,
  },
  { $id: 'HranaStreamResultErrorSchema' },
);

export const HranaStreamResultSchema = Type.Union(
  [HranaStreamResultOkSchema, HranaStreamResultErrorSchema],
  { $id: 'HranaStreamResultSchema' },
);

export const HranaPipelineRespBodySchema = Type.Object(
  {
    baton: Type.Union([Type.String(), Type.Null()]),
    base_url: Type.Union([Type.String(), Type.Null()]),
    results: Type.Array(HranaStreamResultSchema),
  },
  { $id: 'HranaPipelineRespBodySchema' },
);
