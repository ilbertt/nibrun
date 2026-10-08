import { Value } from '@sinclair/typebox/value';
import { Elysia, StatusMap } from 'elysia';
import { OwnerIdSchema, SqliteConnectionIdSchema } from '#lib/api/identifiers.ts';
import { Identity } from '#lib/auth/plugin.ts';
import { pathBelow, RoutePrefix } from '#lib/routes/prefixes.ts';
import { SQLITE_CONNECTIONS_BASE_PATH } from '#lib/sqlite/routes.ts';
import { SqliteConnectionResponseSchema } from '#routes/api/sqlite/connections/[connectionId]/model.ts';
import { SqliteConnectionParamsSchema } from '#routes/api/sqlite/connections/model.ts';
import { AuthPlugin, SqliteServicePlugin } from '#services/plugins.ts';

export const SqliteConnectionsConnectionIdController = new Elysia()
  .use(AuthPlugin)
  .use(SqliteServicePlugin)
  .get(
    pathBelow({ path: `${SQLITE_CONNECTIONS_BASE_PATH}:connectionId`, prefix: RoutePrefix.Api }),
    async function get({ sqliteService, params, user, status }) {
      return status(
        StatusMap.OK,
        await sqliteService.getConnection({
          id: Value.Parse(SqliteConnectionIdSchema, params.connectionId),
          ownerId: Value.Parse(OwnerIdSchema, user.id),
        }),
      );
    },
    {
      auth: Identity.Optional,
      params: SqliteConnectionParamsSchema,
      response: { [StatusMap.OK]: SqliteConnectionResponseSchema },
    },
  );
