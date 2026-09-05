import { AppIdSchema, ImportIdSchema, OwnerIdSchema, Value } from '@repo/protocol';
import { Elysia, StatusMap, t } from 'elysia';
import { authPlugin } from '#lib/auth/plugin.ts';
import {
  ImportResponseSchema,
  UpdateImportBodySchema,
} from '#routes/api/apps/[appId]/imports/model.ts';
import { ImportsServicePlugin, loggerPlugin } from '#services/plugins.ts';

export const AppsAppIdImportsImportIdController = new Elysia()
  .use(loggerPlugin('appsAppIdImportsImportIdController'))
  .use(authPlugin)
  .use(ImportsServicePlugin)
  .guard({ auth: true })
  .get(
    '/apps/:appId/imports/:importId',
    async ({ importsService, params, user, status }) => {
      const stored = await importsService.get({
        appId: Value.Parse(AppIdSchema, params.appId),
        importId: Value.Parse(ImportIdSchema, params.importId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
      });
      return status(StatusMap.OK, stored);
    },
    {
      response: { [StatusMap.OK]: ImportResponseSchema },
    },
  )
  .patch(
    '/apps/:appId/imports/:importId',
    async ({ importsService, params, body, user, status }) => {
      const appId = Value.Parse(AppIdSchema, params.appId);
      const importId = Value.Parse(ImportIdSchema, params.importId);
      const ownerId = Value.Parse(OwnerIdSchema, user.id);

      if (body.upload === 'failed') {
        await importsService.failUpload({ appId, importId, ownerId });
        return status(StatusMap['No Content'], undefined);
      }

      const stored = await importsService.completeUpload({ appId, importId, ownerId });
      return status(StatusMap.OK, stored);
    },
    {
      body: UpdateImportBodySchema,
      response: {
        [StatusMap.OK]: ImportResponseSchema,
        [StatusMap['No Content']]: t.Void(),
      },
    },
  );
