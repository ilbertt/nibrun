import { ArtifactSchema, type OwnerId } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { authPlugin } from '#lib/auth/plugin.ts';
import {
  CreateArtifactBodySchema,
  ListArtifactsResponseSchema,
} from '#routes/api/apps/[appId]/artifacts/model.ts';
import { AppParamsSchema } from '#routes/api/apps/[appId]/model.ts';
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
        appId: params.appId,
        ownerId: user.id as OwnerId,
      });
      return status(StatusMap.OK, { artifacts });
    },
    {
      params: AppParamsSchema,
      response: { [StatusMap.OK]: ListArtifactsResponseSchema },
    },
  )
  .post(
    '/apps/:appId/artifacts',
    async ({ artifactsService, params, body, user, status }) => {
      const artifact = await artifactsService.create({
        appId: params.appId,
        ownerId: user.id as OwnerId,
        binary: body.binary,
      });
      return status(StatusMap.Created, artifact);
    },
    {
      params: AppParamsSchema,
      body: CreateArtifactBodySchema,
      response: { [StatusMap.Created]: ArtifactSchema },
    },
  );
