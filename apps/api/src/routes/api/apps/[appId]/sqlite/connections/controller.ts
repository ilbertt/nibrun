import { AppIdSchema, OwnerIdSchema, Value } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { Identity } from '#lib/auth/plugin.ts';
import { assertSqliteOrigin, sqliteRequestSignal } from '#lib/sqlite/http.ts';
import {
  SelectedSqliteFileSchema,
  SelectSqliteFileSchema,
} from '#routes/api/apps/[appId]/sqlite/connections/model.ts';
import { AuthPlugin, SqliteServicePlugin } from '#services/plugins.ts';

export const AppsAppIdSqliteConnectionsController = new Elysia()
  .use(AuthPlugin)
  .use(SqliteServicePlugin)
  .post(
    '/apps/:appId/sqlite/connections',
    async function select({ sqliteService, sqliteOrigin, params, body, user, request, status }) {
      assertSqliteOrigin({ request, allowedOrigin: sqliteOrigin });
      return status(
        StatusMap.Created,
        await sqliteService.select({
          appId: Value.Parse(AppIdSchema, params.appId),
          ownerId: Value.Parse(OwnerIdSchema, user.id),
          path: body.path,
          signal: sqliteRequestSignal(request),
        }),
      );
    },
    {
      auth: Identity.Optional,
      body: SelectSqliteFileSchema,
      response: { [StatusMap.Created]: SelectedSqliteFileSchema },
    },
  );
