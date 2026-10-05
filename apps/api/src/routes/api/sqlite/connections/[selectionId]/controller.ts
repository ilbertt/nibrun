import { OwnerIdSchema, Value } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { Identity } from '#lib/auth/plugin.ts';
import { assertSqliteOrigin } from '#lib/sqlite/http.ts';
import { ClosedSqliteSelectionSchema } from '#routes/api/sqlite/connections/[selectionId]/model.ts';
import { SqliteConnectionParamsSchema } from '#routes/api/sqlite/connections/model.ts';
import { AuthPlugin, SqliteServicePlugin } from '#services/plugins.ts';

export const SqliteConnectionsSelectionIdController = new Elysia()
  .use(AuthPlugin)
  .use(SqliteServicePlugin)
  .delete(
    '/sqlite/connections/:selectionId',
    async function close({ sqliteService, sqliteOrigin, params, user, request, status }) {
      assertSqliteOrigin({ request, allowedOrigin: sqliteOrigin });
      await sqliteService.closeSelection({
        id: params.selectionId,
        ownerId: Value.Parse(OwnerIdSchema, user.id),
      });
      return status(StatusMap.OK, { closed: true as const });
    },
    {
      auth: Identity.Optional,
      params: SqliteConnectionParamsSchema,
      response: { [StatusMap.OK]: ClosedSqliteSelectionSchema },
    },
  );
