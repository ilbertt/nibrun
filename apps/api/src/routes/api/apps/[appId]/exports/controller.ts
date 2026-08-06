import type { OwnerId } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { authPlugin } from '#lib/auth/plugin.ts';
import {
  ExportResponseSchema,
  ListExportsResponseSchema,
} from '#routes/api/apps/[appId]/exports/model.ts';
import { AppParamsSchema } from '#routes/api/apps/[appId]/model.ts';
import { ExportsServicePlugin, loggerPlugin } from '#services/plugins.ts';

export const AppsAppIdExportsController = new Elysia()
  .use(loggerPlugin('appsAppIdExportsController'))
  .use(authPlugin)
  .use(ExportsServicePlugin)
  .guard({ auth: true })
  .get(
    '/apps/:appId/exports',
    async ({ exportsService, params, user, status }) => {
      const exports = await exportsService.list({
        appId: params.appId,
        ownerId: user.id as OwnerId,
      });
      return status(StatusMap.OK, { exports });
    },
    {
      params: AppParamsSchema,
      response: { [StatusMap.OK]: ListExportsResponseSchema },
    },
  )
  /**
   * Accepted rather than created: nothing is downloadable yet. The host that owns the volume has
   * to read the filesystem and write the bundle first, so the response names the export to poll.
   */
  .post(
    '/apps/:appId/exports',
    async ({ exportsService, params, user, status }) => {
      const requested = await exportsService.request({
        appId: params.appId,
        ownerId: user.id as OwnerId,
      });
      return status(StatusMap.Accepted, requested);
    },
    {
      params: AppParamsSchema,
      response: { [StatusMap.Accepted]: ExportResponseSchema },
    },
  );
