import { AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Elysia, StatusMap } from 'elysia';
import { OwnerIdSchema, SqliteConnectionIdSchema } from '#lib/api/identifiers.ts';
import { Identity } from '#lib/auth/plugin.ts';
import { assertSqliteOrigin } from '#lib/sqlite/http.ts';
import {
  DeletedSqliteConnectionSchema,
  DeleteSqliteConnectionParamsSchema,
} from '#routes/api/apps/[appId]/sqlite/connections/[connectionId]/model.ts';
import { AuthPlugin, SqliteServicePlugin } from '#services/plugins.ts';

export const AppsAppIdSqliteConnectionsConnectionIdController = new Elysia()
  .use(AuthPlugin)
  .use(SqliteServicePlugin)
  .delete(
    '/apps/:appId/sqlite/connections/:connectionId',
    async function remove({ sqliteService, sqliteOrigin, params, user, request, status }) {
      assertSqliteOrigin({ request, allowedOrigin: sqliteOrigin });
      await sqliteService.removeConnection({
        appId: Value.Parse(AppIdSchema, params.appId),
        id: Value.Parse(SqliteConnectionIdSchema, params.connectionId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
      });
      return status(StatusMap.OK, { deleted: true as const });
    },
    {
      auth: Identity.Optional,
      params: DeleteSqliteConnectionParamsSchema,
      response: { [StatusMap.OK]: DeletedSqliteConnectionSchema },
    },
  );
