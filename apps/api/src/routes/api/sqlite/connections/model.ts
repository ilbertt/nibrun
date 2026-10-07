import { publicSchema } from '@repo/typebox-extensions';
import { t } from 'elysia';
import { SqliteConnectionIdSchema } from '#lib/api/identifiers.ts';

export const SqliteConnectionParamsSchema = t.Object({
  connectionId: publicSchema(SqliteConnectionIdSchema),
});
