import { HranaError, hranaError } from '@repo/sqlite';
import { Value } from '@sinclair/typebox/value';
import { Elysia, StatusMap } from 'elysia';
import { OwnerIdSchema, SqliteConnectionIdSchema } from '#lib/api/identifiers.ts';
import { Identity } from '#lib/auth/plugin.ts';
import { pathBelow, RoutePrefix } from '#lib/routes/prefixes.ts';
import { assertSqliteOrigin, sqliteRequestSignal } from '#lib/sqlite/http.ts';
import { SQLITE_CONNECTIONS_BASE_PATH } from '#lib/sqlite/routes.ts';
import {
  SqlitePipelineBodySchema,
  SqlitePipelineErrorSchema,
  SqlitePipelineResponseSchema,
} from '#routes/api/sqlite/connections/[connectionId]/v2/pipeline/model.ts';
import { SqliteConnectionParamsSchema } from '#routes/api/sqlite/connections/model.ts';
import { AuthPlugin, SqliteServicePlugin } from '#services/plugins.ts';

export function createSqliteConnectionsConnectionIdV2PipelineController({
  authPlugin,
  sqliteServicePlugin,
}: {
  authPlugin: typeof AuthPlugin;
  sqliteServicePlugin: typeof SqliteServicePlugin;
}) {
  return new Elysia()
    .use(authPlugin)
    .use(sqliteServicePlugin)
    .post(
      pathBelow({
        path: `${SQLITE_CONNECTIONS_BASE_PATH}:connectionId/v2/pipeline`,
        prefix: RoutePrefix.Api,
      }),
      async function pipeline({ sqliteService, sqliteOrigin, params, body, user, request }) {
        assertSqliteOrigin({ request, allowedOrigin: sqliteOrigin });
        try {
          return Response.json(
            await sqliteService.pipeline({
              id: Value.Parse(SqliteConnectionIdSchema, params.connectionId),
              ownerId: Value.Parse(OwnerIdSchema, user.id),
              body,
              signal: sqliteRequestSignal(request),
            }),
          );
        } catch (error) {
          if (error instanceof HranaError) {
            return Response.json(hranaError(error), { status: StatusMap['Bad Request'] });
          }
          throw error;
        }
      },
      {
        auth: Identity.Optional,
        params: SqliteConnectionParamsSchema,
        body: SqlitePipelineBodySchema,
        response: {
          [StatusMap.OK]: SqlitePipelineResponseSchema,
          [StatusMap['Bad Request']]: SqlitePipelineErrorSchema,
        },
      },
    );
}

export const SqliteConnectionsConnectionIdV2PipelineController =
  createSqliteConnectionsConnectionIdV2PipelineController({
    authPlugin: AuthPlugin,
    sqliteServicePlugin: SqliteServicePlugin,
  });
