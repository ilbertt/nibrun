import { AppIdSchema, OwnerIdSchema, Value } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { authPlugin } from '#lib/auth/plugin.ts';
import { AppActivationRequestSchema } from '#routes/api/apps/[appId]/activation/model.ts';
import { AppResponseSchema } from '#routes/api/apps/model.ts';
import { AppsServicePlugin, loggerPlugin } from '#services/plugins.ts';

export const AppsAppIdActivationController = new Elysia()
  .use(loggerPlugin('appsAppIdActivationController'))
  .use(authPlugin)
  .use(AppsServicePlugin)
  .guard({ auth: true })
  // Beside the state rather than folded into the app patch: that one appends a config version a
  // deployment can pin, and how an app comes up is deliberately not something a rollback replays.
  .patch(
    '/apps/:appId/activation',
    async ({ appsService, params, body, user, status }) => {
      const app = await appsService.setActivation({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        patch: body,
      });
      return status(StatusMap.OK, app);
    },
    {
      body: AppActivationRequestSchema,
      response: { [StatusMap.OK]: AppResponseSchema },
    },
  );
