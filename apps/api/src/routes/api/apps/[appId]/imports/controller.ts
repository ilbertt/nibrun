import { AppIdSchema, OwnerIdSchema, Value } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import {
  CreateImportBodySchema,
  CreateImportResponseSchema,
} from '#routes/api/apps/[appId]/imports/model.ts';
import { AuthPlugin, ImportsServicePlugin, loggerPlugin } from '#services/plugins.ts';

export const AppsAppIdImportsController = new Elysia()
  .use(loggerPlugin('appsAppIdImportsController'))
  .use(AuthPlugin)
  .use(ImportsServicePlugin)
  .guard({ auth: true })
  // Created rather than OK: the import exists from here on, and what is left to do with it is send
  // the bytes to the url this answers with.
  .post(
    '/apps/:appId/imports',
    async ({ importsService, params, body, user, status }) => {
      const created = await importsService.create({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        filename: body.filename,
        sizeBytes: body.sizeBytes,
      });
      return status(StatusMap.Created, created);
    },
    {
      body: CreateImportBodySchema,
      response: { [StatusMap.Created]: CreateImportResponseSchema },
    },
  );
