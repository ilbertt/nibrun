// Generated from the pinned MIT-licensed Hrana v2 declarations. Run bun codegen:hrana.
import { Type, type Static } from '@sinclair/typebox';

export type HranaInt32 = Static<typeof HranaInt32Schema>;
export const HranaInt32Schema = Type.Number({ $id: 'HranaInt32Schema' });

export type HranaCloseStreamReq = Static<typeof HranaCloseStreamReqSchema>;
export const HranaCloseStreamReqSchema = Type.Object(
  {
    type: Type.Literal('close'),
  },
  { $id: 'HranaCloseStreamReqSchema' },
);

export type HranaValue = Static<typeof HranaValueSchema>;
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

export type HranaNamedArg = Static<typeof HranaNamedArgSchema>;
export const HranaNamedArgSchema = Type.Object(
  {
    name: Type.String(),
    value: HranaValueSchema,
  },
  { $id: 'HranaNamedArgSchema' },
);

export type HranaStmt = Static<typeof HranaStmtSchema>;
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

export type HranaExecuteStreamReq = Static<typeof HranaExecuteStreamReqSchema>;
export const HranaExecuteStreamReqSchema = Type.Object(
  {
    type: Type.Literal('execute'),
    stmt: HranaStmtSchema,
  },
  { $id: 'HranaExecuteStreamReqSchema' },
);

export type HranaBatchCond = Static<typeof HranaBatchCondSchema>;
export const HranaBatchCondSchema = Type.Recursive(
  (This) =>
    Type.Union([
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
        cond: This,
      }),
      Type.Object({
        type: Type.Literal('and'),
        conds: Type.Array(This),
      }),
      Type.Object({
        type: Type.Literal('or'),
        conds: Type.Array(This),
      }),
    ]),
  { $id: 'HranaBatchCondSchema' },
);

export type HranaBatchStep = Static<typeof HranaBatchStepSchema>;
export const HranaBatchStepSchema = Type.Object(
  {
    condition: Type.Optional(Type.Union([HranaBatchCondSchema, Type.Null()])),
    stmt: HranaStmtSchema,
  },
  { $id: 'HranaBatchStepSchema' },
);

export type HranaBatch = Static<typeof HranaBatchSchema>;
export const HranaBatchSchema = Type.Object(
  {
    steps: Type.Array(HranaBatchStepSchema),
  },
  { $id: 'HranaBatchSchema' },
);

export type HranaBatchStreamReq = Static<typeof HranaBatchStreamReqSchema>;
export const HranaBatchStreamReqSchema = Type.Object(
  {
    type: Type.Literal('batch'),
    batch: HranaBatchSchema,
  },
  { $id: 'HranaBatchStreamReqSchema' },
);

export type HranaSequenceStreamReq = Static<typeof HranaSequenceStreamReqSchema>;
export const HranaSequenceStreamReqSchema = Type.Object(
  {
    type: Type.Literal('sequence'),
    sql: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    sql_id: Type.Optional(Type.Union([HranaInt32Schema, Type.Null()])),
  },
  { $id: 'HranaSequenceStreamReqSchema' },
);

export type HranaDescribeStreamReq = Static<typeof HranaDescribeStreamReqSchema>;
export const HranaDescribeStreamReqSchema = Type.Object(
  {
    type: Type.Literal('describe'),
    sql: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    sql_id: Type.Optional(Type.Union([HranaInt32Schema, Type.Null()])),
  },
  { $id: 'HranaDescribeStreamReqSchema' },
);

export type HranaStoreSqlStreamReq = Static<typeof HranaStoreSqlStreamReqSchema>;
export const HranaStoreSqlStreamReqSchema = Type.Object(
  {
    type: Type.Literal('store_sql'),
    sql_id: HranaInt32Schema,
    sql: Type.String(),
  },
  { $id: 'HranaStoreSqlStreamReqSchema' },
);

export type HranaCloseSqlStreamReq = Static<typeof HranaCloseSqlStreamReqSchema>;
export const HranaCloseSqlStreamReqSchema = Type.Object(
  {
    type: Type.Literal('close_sql'),
    sql_id: HranaInt32Schema,
  },
  { $id: 'HranaCloseSqlStreamReqSchema' },
);

export type HranaStreamRequest = Static<typeof HranaStreamRequestSchema>;
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

export type HranaPipelineReqBody = Static<typeof HranaPipelineReqBodySchema>;
export const HranaPipelineReqBodySchema = Type.Object(
  {
    baton: Type.Union([Type.String(), Type.Null()]),
    requests: Type.Array(HranaStreamRequestSchema),
  },
  { $id: 'HranaPipelineReqBodySchema' },
);

export type HranaCloseStreamResp = Static<typeof HranaCloseStreamRespSchema>;
export const HranaCloseStreamRespSchema = Type.Object(
  {
    type: Type.Literal('close'),
  },
  { $id: 'HranaCloseStreamRespSchema' },
);

export type HranaCol = Static<typeof HranaColSchema>;
export const HranaColSchema = Type.Object(
  {
    name: Type.Union([Type.String(), Type.Null()]),
    decltype: Type.Union([Type.String(), Type.Null()]),
  },
  { $id: 'HranaColSchema' },
);

export type HranaStmtResult = Static<typeof HranaStmtResultSchema>;
export const HranaStmtResultSchema = Type.Object(
  {
    cols: Type.Array(HranaColSchema),
    rows: Type.Array(Type.Array(HranaValueSchema)),
    affected_row_count: HranaInt32Schema,
    last_insert_rowid: Type.Union([Type.String(), Type.Null()]),
  },
  { $id: 'HranaStmtResultSchema' },
);

export type HranaExecuteStreamResp = Static<typeof HranaExecuteStreamRespSchema>;
export const HranaExecuteStreamRespSchema = Type.Object(
  {
    type: Type.Literal('execute'),
    result: HranaStmtResultSchema,
  },
  { $id: 'HranaExecuteStreamRespSchema' },
);

export type HranaError = Static<typeof HranaErrorSchema>;
export const HranaErrorSchema = Type.Object(
  {
    message: Type.String(),
    code: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  },
  { $id: 'HranaErrorSchema' },
);

export type HranaBatchResult = Static<typeof HranaBatchResultSchema>;
export const HranaBatchResultSchema = Type.Object(
  {
    step_results: Type.Array(Type.Union([HranaStmtResultSchema, Type.Null()])),
    step_errors: Type.Array(Type.Union([HranaErrorSchema, Type.Null()])),
  },
  { $id: 'HranaBatchResultSchema' },
);

export type HranaBatchStreamResp = Static<typeof HranaBatchStreamRespSchema>;
export const HranaBatchStreamRespSchema = Type.Object(
  {
    type: Type.Literal('batch'),
    result: HranaBatchResultSchema,
  },
  { $id: 'HranaBatchStreamRespSchema' },
);

export type HranaSequenceStreamResp = Static<typeof HranaSequenceStreamRespSchema>;
export const HranaSequenceStreamRespSchema = Type.Object(
  {
    type: Type.Literal('sequence'),
  },
  { $id: 'HranaSequenceStreamRespSchema' },
);

export type HranaDescribeParam = Static<typeof HranaDescribeParamSchema>;
export const HranaDescribeParamSchema = Type.Object(
  {
    name: Type.Union([Type.String(), Type.Null()]),
  },
  { $id: 'HranaDescribeParamSchema' },
);

export type HranaDescribeCol = Static<typeof HranaDescribeColSchema>;
export const HranaDescribeColSchema = Type.Object(
  {
    name: Type.String(),
    decltype: Type.Union([Type.String(), Type.Null()]),
  },
  { $id: 'HranaDescribeColSchema' },
);

export type HranaDescribeResult = Static<typeof HranaDescribeResultSchema>;
export const HranaDescribeResultSchema = Type.Object(
  {
    params: Type.Array(HranaDescribeParamSchema),
    cols: Type.Array(HranaDescribeColSchema),
    is_explain: Type.Boolean(),
    is_readonly: Type.Boolean(),
  },
  { $id: 'HranaDescribeResultSchema' },
);

export type HranaDescribeStreamResp = Static<typeof HranaDescribeStreamRespSchema>;
export const HranaDescribeStreamRespSchema = Type.Object(
  {
    type: Type.Literal('describe'),
    result: HranaDescribeResultSchema,
  },
  { $id: 'HranaDescribeStreamRespSchema' },
);

export type HranaStoreSqlStreamResp = Static<typeof HranaStoreSqlStreamRespSchema>;
export const HranaStoreSqlStreamRespSchema = Type.Object(
  {
    type: Type.Literal('store_sql'),
  },
  { $id: 'HranaStoreSqlStreamRespSchema' },
);

export type HranaCloseSqlStreamResp = Static<typeof HranaCloseSqlStreamRespSchema>;
export const HranaCloseSqlStreamRespSchema = Type.Object(
  {
    type: Type.Literal('close_sql'),
  },
  { $id: 'HranaCloseSqlStreamRespSchema' },
);

export type HranaStreamResponse = Static<typeof HranaStreamResponseSchema>;
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

export type HranaStreamResultOk = Static<typeof HranaStreamResultOkSchema>;
export const HranaStreamResultOkSchema = Type.Object(
  {
    type: Type.Literal('ok'),
    response: HranaStreamResponseSchema,
  },
  { $id: 'HranaStreamResultOkSchema' },
);

export type HranaStreamResultError = Static<typeof HranaStreamResultErrorSchema>;
export const HranaStreamResultErrorSchema = Type.Object(
  {
    type: Type.Literal('error'),
    error: HranaErrorSchema,
  },
  { $id: 'HranaStreamResultErrorSchema' },
);

export type HranaStreamResult = Static<typeof HranaStreamResultSchema>;
export const HranaStreamResultSchema = Type.Union(
  [HranaStreamResultOkSchema, HranaStreamResultErrorSchema],
  { $id: 'HranaStreamResultSchema' },
);

export type HranaPipelineRespBody = Static<typeof HranaPipelineRespBodySchema>;
export const HranaPipelineRespBodySchema = Type.Object(
  {
    baton: Type.Union([Type.String(), Type.Null()]),
    base_url: Type.Union([Type.String(), Type.Null()]),
    results: Type.Array(HranaStreamResultSchema),
  },
  { $id: 'HranaPipelineRespBodySchema' },
);
