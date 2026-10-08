import { AppIdSchema } from '@repo/protocol';
import { publicSchema } from '@repo/typebox-extensions';
import { t } from 'elysia';
import { SqliteConnectionParamsSchema } from '#routes/api/sqlite/connections/model.ts';

export const DeletedSqliteConnectionSchema = t.Object({ deleted: t.Literal(true) });

export const DeleteSqliteConnectionParamsSchema = t.Object({
  appId: publicSchema(AppIdSchema),
  ...SqliteConnectionParamsSchema.properties,
});
