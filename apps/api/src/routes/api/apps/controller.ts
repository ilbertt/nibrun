import type { OwnerId } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { authPlugin } from '#lib/auth/plugin.ts';
import { AppByIdController } from '#routes/api/apps/[id]/controller.ts';
import {
  AppResponseSchema,
  CreateAppRequestSchema,
  ListAppsResponseSchema,
} from '#routes/api/apps/model.ts';
import { AppsServicePlugin, loggerPlugin } from '#services/plugins.ts';

export const AppsController = new Elysia({ prefix: '/apps' })
  .use(loggerPlugin('appsController'))
  .use(authPlugin)
  .use(AppsServicePlugin)
  .guard({ auth: true })
  .get(
    '/',
    async ({ appsService, user, status }) => {
      const apps = await appsService.list({ ownerId: user.id as OwnerId });
      return status(StatusMap.OK, { apps });
    },
    {
      response: { [StatusMap.OK]: ListAppsResponseSchema },
    },
  )
  .post(
    '/',
    async ({ appsService, body, user, status }) => {
      const app = await appsService.create({
        ownerId: user.id as OwnerId,
        name: body.name,
        config: body.config,
      });
      return status(StatusMap.Created, app);
    },
    {
      body: CreateAppRequestSchema,
      response: { [StatusMap.Created]: AppResponseSchema },
    },
  )
  .use(AppByIdController);
