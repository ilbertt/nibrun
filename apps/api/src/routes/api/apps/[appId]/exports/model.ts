import { ExportIdSchema, ExportSchema } from '@repo/protocol';
import { t } from 'elysia';
import { AppParamsSchema } from '#routes/api/apps/[appId]/model.ts';

export const ExportParamsSchema = t.Composite([
  AppParamsSchema,
  t.Object({ exportId: ExportIdSchema }),
]);

/**
 * `objectKey` is dropped and a signed URL put in its place: where the bundle sits is this end's
 * business, and the key on its own reaches nothing. The URL is absent unless the bundle is both
 * written and unexpired, so a client polls until it appears rather than reading `state` itself.
 */
export const ExportResponseSchema = t.Composite([
  t.Omit(ExportSchema, ['objectKey']),
  t.Object({ downloadUrl: t.Optional(t.String()) }),
]);

export const ListExportsResponseSchema = t.Object({
  exports: t.Array(ExportResponseSchema),
});
