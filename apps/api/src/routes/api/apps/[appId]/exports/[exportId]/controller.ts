import { AppIdSchema, ExportIdSchema, OwnerIdSchema, Value } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { authPlugin } from '#lib/auth/plugin.ts';
import { ExportResponseSchema } from '#routes/api/apps/[appId]/exports/model.ts';
import { ExportsServicePlugin, loggerPlugin } from '#services/plugins.ts';

/**
 * What a client polls. The download URL appears here once the host has written the bundle, and
 * it is signed for this response rather than stored, so it is short-lived however long the
 * caller waited before asking.
 */
export const AppsAppIdExportsExportIdController = new Elysia()
  .use(loggerPlugin('appsAppIdExportsExportIdController'))
  .use(authPlugin)
  .use(ExportsServicePlugin)
  .guard({ auth: true })
  .get(
    '/apps/:appId/exports/:exportId',
    async ({ exportsService, params, user, status }) => {
      const found = await exportsService.get({
        appId: Value.Parse(AppIdSchema, params.appId),
        exportId: Value.Parse(ExportIdSchema, params.exportId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
      });
      return status(StatusMap.OK, found);
    },
    {
      response: { [StatusMap.OK]: ExportResponseSchema },
    },
  );
