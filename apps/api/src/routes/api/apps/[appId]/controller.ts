import type { OwnerId } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { authPlugin } from '#lib/auth/plugin.ts';
import { AppParamsSchema } from '#routes/api/apps/[appId]/model.ts';
import { AppConfigPatchSchema, AppResponseSchema } from '#routes/api/apps/model.ts';
import { AppsServicePlugin, loggerPlugin } from '#services/plugins.ts';

export const AppsAppIdController = new Elysia()
  .use(loggerPlugin('appsAppIdController'))
  .use(authPlugin)
  .use(AppsServicePlugin)
  .guard({ auth: true })
  .get(
    '/apps/:appId',
    async ({ appsService, params, user, status }) => {
      const app = await appsService.get({ appId: params.appId, ownerId: user.id as OwnerId });
      return status(StatusMap.OK, app);
    },
    {
      params: AppParamsSchema,
      response: { [StatusMap.OK]: AppResponseSchema },
    },
  )
  .patch(
    '/apps/:appId',
    async ({ appsService, params, body, user, status }) => {
      const app = await appsService.updateConfig({
        appId: params.appId,
        ownerId: user.id as OwnerId,
        patch: body,
      });
      return status(StatusMap.OK, app);
    },
    {
      params: AppParamsSchema,
      body: AppConfigPatchSchema,
      response: { [StatusMap.OK]: AppResponseSchema },
    },
  )
  // Accepted rather than No Content: the app is marked for teardown and the agent does the
  // rest, so the state it comes back in is the whole answer.
  .delete(
    '/apps/:appId',
    async ({ appsService, params, user, status }) => {
      const app = await appsService.delete({ appId: params.appId, ownerId: user.id as OwnerId });
      return status(StatusMap.Accepted, app);
    },
    {
      params: AppParamsSchema,
      response: { [StatusMap.Accepted]: AppResponseSchema },
    },
  );
