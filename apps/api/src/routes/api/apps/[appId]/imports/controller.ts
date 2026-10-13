import { AppIdSchema } from '@repo/protocol';
import { publicSchema } from '@repo/typebox-extensions';
import { Value } from '@sinclair/typebox/value';
import { Elysia, StatusMap } from 'elysia';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { AuthCaller } from '#lib/auth/caller.ts';
import {
  CreateImportBodySchema,
  CreateImportResponseSchema,
} from '#routes/api/apps/[appId]/imports/model.ts';
import { AuthPlugin, ImportsServicePlugin, loggerPlugin } from '#services/plugins.ts';

export const AppsAppIdImportsController = new Elysia()
  .use(loggerPlugin('appsAppIdImportsController'))
  .use(AuthPlugin)
  .use(ImportsServicePlugin)
  .guard({ auth: { policies: [AuthCaller.RegisteredAccount] } })
  .post(
    '/apps/:appId/imports',
    async ({ importsService, params, body: bodyInput, user, status }) => {
      const body = Value.Parse(CreateImportBodySchema, bodyInput);
      const appId = Value.Parse(AppIdSchema, params.appId);
      const ownerId = Value.Parse(OwnerIdSchema, user.id);
      const created =
        'url' in body
          ? await importsService.createFromUrl({
              appId,
              ownerId,
              url: body.url,
              sha256: body.sha256,
            })
          : await importsService.create({
              appId,
              ownerId,
              filename: body.filename,
              sizeBytes: body.sizeBytes,
            });
      return status(StatusMap.Created, created);
    },
    {
      body: publicSchema(CreateImportBodySchema),
      response: { [StatusMap.Created]: publicSchema(CreateImportResponseSchema) },
    },
  );
