import { AppIdSchema, DeploymentIdSchema, GuestPathSchema, TimestampSchema } from '@repo/protocol';
import { t } from 'elysia';
import { SqliteConnectionIdSchema } from '#routes/api/sqlite/connections/model.ts';

export const SelectSqliteFileSchema = t.Object({ path: GuestPathSchema });
export const SelectedSqliteFileSchema = t.Object({
  id: SqliteConnectionIdSchema,
  appId: AppIdSchema,
  deploymentId: DeploymentIdSchema,
  path: GuestPathSchema,
  expiresAt: TimestampSchema,
  url: t.String({ format: 'uri' }),
});
