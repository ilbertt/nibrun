import { t } from 'elysia';

export const SqlitePipelineBodySchema = t.Unknown();
export const SqlitePipelineResponseSchema = t.Unknown();
export const SqlitePipelineErrorSchema = t.Object({
  message: t.String(),
  code: t.String(),
});
