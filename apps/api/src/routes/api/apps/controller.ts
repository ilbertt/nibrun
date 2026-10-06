import { publicSchema } from '@repo/typebox-extensions';
import { Value } from '@sinclair/typebox/value';
import { Elysia, StatusMap } from 'elysia';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { Identity } from '#lib/auth/plugin.ts';
import {
  AppResponseSchema,
  CreateAppRequestSchema,
  ListAppsResponseSchema,
} from '#routes/api/apps/model.ts';
import { AppsServicePlugin, AuthPlugin, loggerPlugin } from '#services/plugins.ts';

export const AppsController = new Elysia()
  .use(loggerPlugin('appsController'))
  .use(AuthPlugin)
  .use(AppsServicePlugin)
  .guard({ auth: Identity.Optional })
  .get(
    '/apps',
    async ({ appsService, user, status }) => {
      const apps = await appsService.list({ ownerId: Value.Parse(OwnerIdSchema, user.id) });
      return status(StatusMap.OK, { apps });
    },
    {
      response: { [StatusMap.OK]: publicSchema(ListAppsResponseSchema) },
    },
  )
  .post(
    '/apps',
    async ({ appsService, body: bodyInput, user, status }) => {
      const body = Value.Parse(CreateAppRequestSchema, bodyInput);
      const app = await appsService.create({
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        isAnonymous: user.isAnonymous,
        name: body.name,
        config: body.config,
      });
      return status(StatusMap.Created, app);
    },
    {
      body: publicSchema(CreateAppRequestSchema),
      response: { [StatusMap.Created]: publicSchema(AppResponseSchema) },
    },
  );
