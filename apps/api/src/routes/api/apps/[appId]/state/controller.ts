import { AppIdSchema, Value } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { publicSchema } from '#lib/api/public-schema.ts';
import { Identity } from '#lib/auth/plugin.ts';
import { AppStateRequestSchema } from '#routes/api/apps/[appId]/state/model.ts';
import { AppResponseSchema } from '#routes/api/apps/model.ts';
import { AppsServicePlugin, AuthPlugin, loggerPlugin } from '#services/plugins.ts';

export const AppsAppIdStateController = new Elysia()
  .use(loggerPlugin('appsAppIdStateController'))
  .use(AuthPlugin)
  .use(AppsServicePlugin)
  .guard({ auth: Identity.Required })
  // Idempotent on purpose: suspending an app twice is suspending it, so a retry after a lost
  // response is the same request rather than a second one.
  .put(
    '/apps/:appId/state',
    async ({ appsService, params, body: bodyInput, user, status }) => {
      const body = Value.Parse(AppStateRequestSchema, bodyInput);
      const app = await appsService.setState({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        state: body.state,
      });
      return status(StatusMap.OK, app);
    },
    {
      body: publicSchema(AppStateRequestSchema),
      response: { [StatusMap.OK]: publicSchema(AppResponseSchema) },
    },
  );
