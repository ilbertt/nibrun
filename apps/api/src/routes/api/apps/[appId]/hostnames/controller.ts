import { AppIdSchema, OwnerIdSchema, Value } from '@repo/protocol';
import { Elysia, StatusMap, t } from 'elysia';
import {
  AddHostnameRequestSchema,
  RemoveHostnameQuerySchema,
} from '#routes/api/apps/[appId]/hostnames/model.ts';
import { AppHostnameResponseSchema } from '#routes/api/apps/model.ts';
import { AuthPlugin, HostnamesServicePlugin, loggerPlugin } from '#services/plugins.ts';

export const AppsAppIdHostnamesController = new Elysia()
  .use(loggerPlugin('appsAppIdHostnamesController'))
  .use(AuthPlugin)
  .use(HostnamesServicePlugin)
  .guard({ auth: true })
  /**
   * Created rather than accepted: the row exists and the edge knows the hostname. What is still
   * outstanding is the owner's own DNS, which is theirs to do — the response carries the record
   * to place, so there is nothing here for them to poll before acting.
   *
   * Saying it again is not a conflict: a domain the app already answers on, or is waiting to,
   * comes back as it is. While it is waiting, that is also what asks the edge to check it now —
   * the owner who has just fixed their records is the one who knows it is time.
   */
  .post(
    '/apps/:appId/hostnames',
    async ({ hostnamesService, params, body, user, status }) => {
      const { hostname, created } = await hostnamesService.add({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        hostname: body.hostname,
      });
      return status(created ? StatusMap.Created : StatusMap.OK, hostname);
    },
    {
      body: AddHostnameRequestSchema,
      response: {
        [StatusMap.Created]: AppHostnameResponseSchema,
        [StatusMap.OK]: AppHostnameResponseSchema,
      },
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
