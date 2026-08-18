import { AppIdSchema, OwnerIdSchema, Value } from '@repo/protocol';
import { Elysia, StatusMap, t } from 'elysia';
import { authPlugin } from '#lib/auth/plugin.ts';
import {
  AddHostnameRequestSchema,
  RemoveHostnameQuerySchema,
} from '#routes/api/apps/[appId]/hostnames/model.ts';
import { AppHostnameResponseSchema } from '#routes/api/apps/model.ts';
import { HostnamesServicePlugin, loggerPlugin } from '#services/plugins.ts';

export const AppsAppIdHostnamesController = new Elysia()
  .use(loggerPlugin('appsAppIdHostnamesController'))
  .use(authPlugin)
  .use(HostnamesServicePlugin)
  .guard({ auth: true })
  /**
   * Created rather than accepted: the row exists and the edge knows the hostname. What is still
   * outstanding is the owner's own DNS, which is theirs to do — the response carries the record
   * to place, so there is nothing here for them to poll before acting.
   */
  .post(
    '/apps/:appId/hostnames',
    async ({ hostnamesService, params, body, user, status }) => {
      const hostname = await hostnamesService.add({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        hostname: body.hostname,
      });
      return status(StatusMap.Created, hostname);
    },
    {
      body: AddHostnameRequestSchema,
      response: { [StatusMap.Created]: AppHostnameResponseSchema },
    },
  )
  .delete(
    '/apps/:appId/hostnames',
    async ({ hostnamesService, params, query, user, status }) => {
      await hostnamesService.remove({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        hostname: query.hostname,
      });
      return status(StatusMap['No Content'], undefined);
    },
    {
      query: RemoveHostnameQuerySchema,
      response: { [StatusMap['No Content']]: t.Void() },
    },
  );
