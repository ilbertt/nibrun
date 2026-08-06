import { ArtifactSchema, OwnerIdSchema, Value } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { authPlugin } from '#lib/auth/plugin.ts';
import { ArtifactParamsSchema } from '#routes/api/apps/[appId]/artifacts/model.ts';
import { ArtifactsServicePlugin, loggerPlugin } from '#services/plugins.ts';

export const AppsAppIdArtifactsArtifactIdController = new Elysia()
  .use(loggerPlugin('appsAppIdArtifactsArtifactIdController'))
  .use(authPlugin)
  .use(ArtifactsServicePlugin)
  .guard({ auth: true })
  .get(
    '/apps/:appId/artifacts/:artifactId',
    async ({ artifactsService, params, user, status }) => {
      const artifact = await artifactsService.get({
        appId: params.appId,
        artifactId: params.artifactId,
        ownerId: Value.Parse(OwnerIdSchema, user.id),
      });
      return status(StatusMap.OK, artifact);
    },
    {
      params: ArtifactParamsSchema,
      response: { [StatusMap.OK]: ArtifactSchema },
    },
  );
