import { OwnerIdSchema, Value } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { Identity } from '#lib/auth/plugin.ts';
import { HranaError, hranaError } from '#lib/hrana/errors.ts';
import { assertSqliteOrigin, sqliteRequestSignal } from '#lib/sqlite/http.ts';
import {
  SqlitePipelineBodySchema,
  SqlitePipelineErrorSchema,
  SqlitePipelineResponseSchema,
} from '#routes/api/sqlite/connections/[selectionId]/v2/pipeline/model.ts';
import { SqliteConnectionParamsSchema } from '#routes/api/sqlite/connections/model.ts';
import { AuthPlugin, SqliteServicePlugin } from '#services/plugins.ts';

export const SqliteConnectionsSelectionIdV2PipelineController = new Elysia()
  .use(AuthPlugin)
  .use(SqliteServicePlugin)
  .post(
    '/sqlite/connections/:selectionId/v2/pipeline',
    async function pipeline({ sqliteService, sqliteOrigin, params, body, user, request, status }) {
      assertSqliteOrigin({ request, allowedOrigin: sqliteOrigin });
      try {
        return Response.json(
          await sqliteService.pipeline({
            id: params.selectionId,
            ownerId: Value.Parse(OwnerIdSchema, user.id),
            body,
            signal: sqliteRequestSignal(request),
          }),
        );
      } catch (error) {
        if (error instanceof HranaError) {
          return status(StatusMap['Bad Request'], hranaError(error));
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
