import { AppIdSchema, OwnerIdSchema, Value } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { authPlugin } from '#lib/auth/plugin.ts';
import {
  AppConfigPatchSchema,
  AppResponseSchema,
  AppStateRequestSchema,
} from '#routes/api/apps/model.ts';
import { AppsServicePlugin, loggerPlugin } from '#services/plugins.ts';

export const AppsAppIdController = new Elysia()
  .use(loggerPlugin('appsAppIdController'))
  .use(authPlugin)
  .use(AppsServicePlugin)
  .guard({ auth: true })
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
      response: { [StatusMap.OK]: AppResponseSchema },
    },
  )
  .patch(
    '/apps/:appId',
    async ({ appsService, params, body, user, status }) => {
      const app = await appsService.updateConfig({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        patch: body,
      });
      return status(StatusMap.OK, app);
    },
    {
      body: AppConfigPatchSchema,
      response: { [StatusMap.OK]: AppResponseSchema },
    },
  )
  // Idempotent on purpose: suspending an app twice is suspending it, so a retry after a lost
  // response is the same request rather than a second one.
  .put(
    '/apps/:appId/state',
    async ({ appsService, params, body, user, status }) => {
      const app = await appsService.setState({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        state: body.state,
      });
      return status(StatusMap.OK, app);
    },
    {
      body: AppStateRequestSchema,
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
      response: { [StatusMap.Accepted]: AppResponseSchema },
    },
  );
