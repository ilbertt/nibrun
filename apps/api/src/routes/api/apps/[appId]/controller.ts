import { AppIdSchema, OwnerIdSchema, Value } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { Identity } from '#lib/auth/plugin.ts';
import { AppPatchSchema, AppResponseSchema } from '#routes/api/apps/model.ts';
import { AppsServicePlugin, AuthPlugin, loggerPlugin } from '#services/plugins.ts';

export const AppsAppIdController = new Elysia()
  .use(loggerPlugin('appsAppIdController'))
  .use(AuthPlugin)
  .use(AppsServicePlugin)
  .get(
    '/apps/:appId',
    async ({ appsService, params, user, status }) => {
      const app = await appsService.get({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
      });
      return status(StatusMap.OK, app);
    },
    {
      auth: Identity.Optional,
      response: { [StatusMap.OK]: AppResponseSchema },
    },
  )
  .patch(
    '/apps/:appId',
    async ({ appsService, params, body, user, status }) => {
      const app = await appsService.update({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        patch: body,
      });
      return status(StatusMap.OK, app);
    },
    {
      auth: Identity.Required,
      body: AppPatchSchema,
      response: { [StatusMap.OK]: AppResponseSchema },
    },
  )
  // Accepted rather than No Content: the app is marked for teardown and the agent does the
  // rest, so the state it comes back in is the whole answer.
  .delete(
    '/apps/:appId',
    async ({ appsService, params, user, status }) => {
      const app = await appsService.delete({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
      });
      return status(StatusMap.Accepted, app);
    },
    {
      auth: Identity.Optional,
      response: { [StatusMap.Accepted]: AppResponseSchema },
    },
  );
