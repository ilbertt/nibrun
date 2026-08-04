import { ArtifactSchema, type OwnerId } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { authPlugin } from '#lib/auth/plugin.ts';
import { ArtifactParamsSchema } from '#routes/api/apps/[id]/artifacts/model.ts';
import { ArtifactsServicePlugin, loggerPlugin } from '#services/plugins.ts';

export const AppArtifactByIdController = new Elysia({ prefix: '/:artifactId' })
  .use(loggerPlugin('appArtifactByIdController'))
  .use(authPlugin)
  .use(ArtifactsServicePlugin)
  .guard({ auth: true })
  .get(
    '/',
    async ({ artifactsService, params, user, status }) => {
      const artifact = await artifactsService.get({
        appId: params.id,
        artifactId: params.artifactId,
        ownerId: user.id as OwnerId,
      });
      return status(StatusMap.OK, artifact);
    },
    {
      params: ArtifactParamsSchema,
      response: { [StatusMap.OK]: ArtifactSchema },
    },
  );
