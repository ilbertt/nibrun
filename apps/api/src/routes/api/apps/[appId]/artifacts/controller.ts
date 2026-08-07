import { AppIdSchema, OwnerIdSchema, Value } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { authPlugin } from '#lib/auth/plugin.ts';
import {
  CreateArtifactBodySchema,
  CreateArtifactResponseSchema,
  ListArtifactsResponseSchema,
} from '#routes/api/apps/[appId]/artifacts/model.ts';
import { ArtifactsServicePlugin, loggerPlugin } from '#services/plugins.ts';

export const AppsAppIdArtifactsController = new Elysia()
  .use(loggerPlugin('appsAppIdArtifactsController'))
  .use(authPlugin)
  .use(ArtifactsServicePlugin)
  .guard({ auth: true })
  .get(
    '/apps/:appId/artifacts',
    async ({ artifactsService, params, user, status }) => {
      const artifacts = await artifactsService.list({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
      });
      return status(StatusMap.OK, { artifacts });
    },
    {
      response: { [StatusMap.OK]: ListArtifactsResponseSchema },
    },
  )
  // Created rather than OK: the artifact exists from here on, and the upload it is waiting for is
  // what the response says where to send.
  .post(
    '/apps/:appId/artifacts',
    async ({ artifactsService, params, body, user, status }) => {
      const upload = await artifactsService.create({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        filename: body.filename,
        sizeBytes: body.sizeBytes,
      });
      return status(StatusMap.Created, upload);
    },
    {
      body: CreateArtifactBodySchema,
      response: { [StatusMap.Created]: CreateArtifactResponseSchema },
    },
  );
