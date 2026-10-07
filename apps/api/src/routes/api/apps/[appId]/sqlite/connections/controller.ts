import { AppIdSchema, GuestPathSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Elysia, StatusMap } from 'elysia';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { Identity } from '#lib/auth/plugin.ts';
import { assertSqliteOrigin, sqliteRequestSignal } from '#lib/sqlite/http.ts';
import {
  CreateSqliteConnectionSchema,
  ListSqliteConnectionsResponseSchema,
  SqliteConnectionResponseSchema,
} from '#routes/api/apps/[appId]/sqlite/connections/model.ts';
import { AuthPlugin, SqliteServicePlugin } from '#services/plugins.ts';

export const AppsAppIdSqliteConnectionsController = new Elysia()
  .use(AuthPlugin)
  .use(SqliteServicePlugin)
  .get(
    '/apps/:appId/sqlite/connections',
    async function list({ sqliteService, params, user, status }) {
      return status(StatusMap.OK, {
        connections: await sqliteService.list({
          appId: Value.Parse(AppIdSchema, params.appId),
          ownerId: Value.Parse(OwnerIdSchema, user.id),
        }),
      });
    },
    { auth: Identity.Optional, response: { [StatusMap.OK]: ListSqliteConnectionsResponseSchema } },
  )
  .post(
    '/apps/:appId/sqlite/connections',
    async function create({ sqliteService, sqliteOrigin, params, body, user, request, status }) {
      assertSqliteOrigin({ request, allowedOrigin: sqliteOrigin });
      return status(
        StatusMap.Created,
        await sqliteService.create({
          appId: Value.Parse(AppIdSchema, params.appId),
          ownerId: Value.Parse(OwnerIdSchema, user.id),
          sqlite_file_path: Value.Parse(GuestPathSchema, body.sqlite_file_path),
          signal: sqliteRequestSignal(request),
        }),
      );
    },
    {
      auth: Identity.Optional,
      body: CreateSqliteConnectionSchema,
      response: { [StatusMap.Created]: SqliteConnectionResponseSchema },
    },
  );
