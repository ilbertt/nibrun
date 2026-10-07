import { HranaErrorSchema, HranaPipelineRespBodySchema } from '@repo/sqlite';
import { publicSchema } from '@repo/typebox-extensions';
import { t } from 'elysia';

export const SqlitePipelineBodySchema = t.Unknown();
export const SqlitePipelineResponseSchema = publicSchema(HranaPipelineRespBodySchema);
export const SqlitePipelineErrorSchema = publicSchema(HranaErrorSchema);
