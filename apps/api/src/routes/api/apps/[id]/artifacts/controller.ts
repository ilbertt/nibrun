import { ArtifactSchema, type OwnerId } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { authPlugin } from '#lib/auth/plugin.ts';
import { AppArtifactByIdController } from '#routes/api/apps/[id]/artifacts/[artifactId]/controller.ts';
import {
  CreateArtifactBodySchema,
  ListArtifactsResponseSchema,
} from '#routes/api/apps/[id]/artifacts/model.ts';
import { AppParamsSchema } from '#routes/api/apps/[id]/model.ts';
import { ArtifactsServicePlugin, loggerPlugin } from '#services/plugins.ts';

export const AppArtifactsController = new Elysia({ prefix: '/artifacts' })
  .use(loggerPlugin('appArtifactsController'))
  .use(authPlugin)
  .use(ArtifactsServicePlugin)
  .guard({ auth: true })
  .get(
    '/',
    async ({ artifactsService, params, user, status }) => {
      const artifacts = await artifactsService.list({
        appId: params.id,
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
    '/',
    async ({ artifactsService, params, body, user, status }) => {
      const artifact = await artifactsService.create({
        appId: params.id,
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
  )
  .use(AppArtifactByIdController);
