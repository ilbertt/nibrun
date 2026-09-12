import { OwnerIdSchema, Value } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
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
      response: { [StatusMap.OK]: ListAppsResponseSchema },
    },
  )
  .post(
    '/apps',
    async ({ appsService, body, user, status }) => {
      const app = await appsService.create({
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        isAnonymous: user.isAnonymous ?? false,
        name: body.name,
        config: body.config,
      });
      return status(StatusMap.Created, app);
    },
    {
      body: CreateAppRequestSchema,
      response: { [StatusMap.Created]: AppResponseSchema },
    },
  );
