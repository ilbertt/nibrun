import { CloneType, type TSchema, Type } from '@sinclair/typebox';
import * as Hrana from '#hrana-v2.ts';
import {
  SQLITE_MAX_COLUMNS,
  SQLITE_MAX_PARAMETERS,
  SQLITE_MAX_ROWS,
  SQLITE_MAX_STATEMENT_LENGTH,
  SQLITE_MAX_VALUE_LENGTH,
} from '#limits.ts';

const MAX_PIPELINE_REQUESTS = 64;
const MAX_BATCH_STEPS = 256;
const MAX_BATON_LENGTH = 128;
const MAX_PARAMETER_NAME_LENGTH = 256;
const MIN_INT32 = -2_147_483_648;
const MAX_INT32 = 2_147_483_647;
const MAX_INTEGER_LENGTH = 20;
const BASE64_INPUT_BYTES = 3;
const BASE64_OUTPUT_CHARACTERS = 4;

export const HranaValueSchema = bounded(Hrana.HranaValueSchema);
export type HranaValue = typeof HranaValueSchema.static;
export const HranaColSchema = bounded(Hrana.HranaColSchema);
export type HranaCol = typeof HranaColSchema.static;
export const HranaStmtSchema = bounded(Hrana.HranaStmtSchema);
export type HranaStmt = typeof HranaStmtSchema.static;
export const HranaStmtResultSchema = bounded(Hrana.HranaStmtResultSchema);
export type HranaStmtResult = typeof HranaStmtResultSchema.static;
export const HranaDescribeResultSchema = bounded(Hrana.HranaDescribeResultSchema);
export type HranaDescribeResult = typeof HranaDescribeResultSchema.static;
export const HranaBatchSchema = bounded(Hrana.HranaBatchSchema);
export type HranaBatch = typeof HranaBatchSchema.static;
export const HranaBatchCondSchema = bounded(Hrana.HranaBatchCondSchema);
export type HranaBatchCond = typeof HranaBatchCondSchema.static;
export const HranaBatchResultSchema = bounded(Hrana.HranaBatchResultSchema);
export type HranaBatchResult = typeof HranaBatchResultSchema.static;
export const HranaStreamRequestSchema = bounded(Hrana.HranaStreamRequestSchema);
export type HranaStreamRequest = typeof HranaStreamRequestSchema.static;
export const HranaStreamResponseSchema = bounded(Hrana.HranaStreamResponseSchema);
export type HranaStreamResponse = typeof HranaStreamResponseSchema.static;
export const HranaStreamResultSchema = bounded(Hrana.HranaStreamResultSchema);
export type HranaStreamResult = typeof HranaStreamResultSchema.static;
const PipelineReqBodySchema = bounded(Hrana.HranaPipelineReqBodySchema);
export const HranaPipelineReqBodySchema = Type.Object({
  ...PipelineReqBodySchema.properties,
  baton: Type.Optional(PipelineReqBodySchema.properties.baton),
});
export type HranaPipelineReqBody = typeof HranaPipelineReqBodySchema.static;
export const HranaPipelineRespBodySchema = bounded(Hrana.HranaPipelineRespBodySchema);
export type HranaPipelineRespBody = typeof HranaPipelineRespBodySchema.static;

function bounded<Schema extends TSchema>(schema: Schema): Schema {
  const result = CloneType(schema);
  constrain({ node: result, field: undefined });
  return result;
}

function constrain({ node, field }: { node: unknown; field: string | undefined }): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      constrain({ node: item, field });
    }
    return;
  }
  if (!node || typeof node !== 'object') {
    return;
  }
  const schema = node as TSchema;
  for (const [name, child] of Object.entries(schema)) {
    constrain({ node: child, field: name === 'anyOf' ? field : name });
  }
  constrainScalar({ schema, field });
  if (schema.type === 'array') {
    const limits: Record<string, number> = {
      requests: MAX_PIPELINE_REQUESTS,
      steps: MAX_BATCH_STEPS,
      cols: SQLITE_MAX_COLUMNS,
      rows: SQLITE_MAX_ROWS,
    };
    schema.maxItems = limits[field ?? ''] ?? SQLITE_MAX_PARAMETERS;
  }
  constrainValue(schema);
}

function constrainScalar({ schema, field }: { schema: TSchema; field: string | undefined }): void {
  if (schema.type === 'string') {
    schema.maxLength = field === 'sql' ? SQLITE_MAX_STATEMENT_LENGTH : SQLITE_MAX_VALUE_LENGTH;
    if (field === 'baton') {
      schema.minLength = 1;
      schema.maxLength = MAX_BATON_LENGTH;
    }
  }
  if (schema.$id === Hrana.HranaInt32Schema.$id) {
    Object.assign(schema, Type.Integer({ minimum: MIN_INT32, maximum: MAX_INT32 }));
  }
  if (field === 'affected_row_count') {
    schema.minimum = 0;
  }
  if (field === 'step') {
    schema.minimum = 0;
    schema.maximum = MAX_BATCH_STEPS;
  }
  if (
    schema.$id === Hrana.HranaNamedArgSchema.$id ||
    schema.$id === Hrana.HranaDescribeParamSchema.$id
  ) {
    constrainParameterName(schema.properties.name);
  }
}

function constrainParameterName(schema: TSchema): void {
  if (schema.type === 'string') {
    schema.maxLength = MAX_PARAMETER_NAME_LENGTH;
  }
  for (const member of schema.anyOf ?? []) {
    constrainParameterName(member);
  }
}

function constrainValue(schema: TSchema): void {
  if (schema.properties?.type?.const === 'integer') {
    schema.properties.value.pattern = '^-?(0|[1-9][0-9]*)$';
    schema.properties.value.maxLength = MAX_INTEGER_LENGTH;
  }
  if (schema.properties?.type?.const === 'blob') {
    schema.properties.base64.pattern =
      '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$';
    schema.properties.base64.maxLength =
      Math.ceil(SQLITE_MAX_VALUE_LENGTH / BASE64_INPUT_BYTES) * BASE64_OUTPUT_CHARACTERS;
  }
}
