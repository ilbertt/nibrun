import { OwnerIdSchema, Value } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { Identity } from '#lib/auth/plugin.ts';
import { SqliteVersionResponseSchema } from '#routes/api/sqlite/connections/[selectionId]/v2/model.ts';
import { SqliteConnectionParamsSchema } from '#routes/api/sqlite/connections/model.ts';
import { AuthPlugin, SqliteServicePlugin } from '#services/plugins.ts';

export const SqliteConnectionsSelectionIdV2Controller = new Elysia()
  .use(AuthPlugin)
  .use(SqliteServicePlugin)
  .get(
    '/sqlite/connections/:selectionId/v2',
    async function version({ sqliteService, params, user, status }) {
      await sqliteService.checkSelection({
        id: params.selectionId,
        ownerId: Value.Parse(OwnerIdSchema, user.id),
      });
      return status(StatusMap.OK, {});
    },
    {
      auth: Identity.Optional,
      params: SqliteConnectionParamsSchema,
      response: { [StatusMap.OK]: SqliteVersionResponseSchema },
    },
  );
