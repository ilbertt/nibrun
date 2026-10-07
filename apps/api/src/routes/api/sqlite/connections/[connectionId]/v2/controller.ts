import { Value } from '@sinclair/typebox/value';
import { Elysia, StatusMap } from 'elysia';
import { OwnerIdSchema, SqliteConnectionIdSchema } from '#lib/api/identifiers.ts';
import { Identity } from '#lib/auth/plugin.ts';
import { pathBelow, RoutePrefix } from '#lib/routes/prefixes.ts';
import { SqliteClientCorsPlugin } from '#lib/sqlite/cors.ts';
import { assertSqliteCookieOrigin } from '#lib/sqlite/http.ts';
import { SQLITE_CONNECTIONS_BASE_PATH } from '#lib/sqlite/routes.ts';
import { SqliteVersionResponseSchema } from '#routes/api/sqlite/connections/[connectionId]/v2/model.ts';
import { SqliteConnectionsConnectionIdV2PipelineController } from '#routes/api/sqlite/connections/[connectionId]/v2/pipeline/controller.ts';
import { SqliteConnectionParamsSchema } from '#routes/api/sqlite/connections/model.ts';
import { AuthPlugin, SqliteServicePlugin } from '#services/plugins.ts';

export const SqliteConnectionsConnectionIdV2Controller = new Elysia()
  .use(SqliteClientCorsPlugin)
  .use(AuthPlugin)
  .use(SqliteServicePlugin)
  .get(
    pathBelow({
      path: `${SQLITE_CONNECTIONS_BASE_PATH}:connectionId/v2`,
      prefix: RoutePrefix.Api,
    }),
    async function version({ sqliteService, sqliteOrigin, params, user, status, request }) {
      assertSqliteCookieOrigin({ request, allowedOrigin: sqliteOrigin });
      await sqliteService.checkConnection({
        id: Value.Parse(SqliteConnectionIdSchema, params.connectionId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
      });
      return status(StatusMap.OK, {});
    },
    {
      auth: Identity.Optional,
      params: SqliteConnectionParamsSchema,
      response: { [StatusMap.OK]: SqliteVersionResponseSchema },
    },
  )
  .use(SqliteConnectionsConnectionIdV2PipelineController);
