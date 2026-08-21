import { AppIdSchema, OwnerIdSchema, Value } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { authPlugin } from '#lib/auth/plugin.ts';
import { AppStateRequestSchema } from '#routes/api/apps/[appId]/state/model.ts';
import { AppResponseSchema } from '#routes/api/apps/model.ts';
import { AppsServicePlugin, loggerPlugin } from '#services/plugins.ts';

export const AppsAppIdStateController = new Elysia()
  .use(loggerPlugin('appsAppIdStateController'))
  .use(authPlugin)
  .use(AppsServicePlugin)
  .guard({ auth: true })
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
  );
