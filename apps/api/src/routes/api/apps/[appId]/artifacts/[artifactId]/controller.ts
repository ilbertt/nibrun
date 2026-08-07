import {
  AppIdSchema,
  ArtifactIdSchema,
  ArtifactSchema,
  OwnerIdSchema,
  Value,
} from '@repo/protocol';
import { Elysia, StatusMap, t } from 'elysia';
import { authPlugin } from '#lib/auth/plugin.ts';
import { UpdateArtifactBodySchema } from '#routes/api/apps/[appId]/artifacts/model.ts';
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
        appId: Value.Parse(AppIdSchema, params.appId),
        artifactId: Value.Parse(ArtifactIdSchema, params.artifactId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
      });
      return status(StatusMap.OK, artifact);
    },
    {
      response: { [StatusMap.OK]: ArtifactSchema },
    },
  )
  .patch(
    '/apps/:appId/artifacts/:artifactId',
    async ({ artifactsService, params, body, user, status }) => {
      const appId = Value.Parse(AppIdSchema, params.appId);
      const artifactId = Value.Parse(ArtifactIdSchema, params.artifactId);
      const ownerId = Value.Parse(OwnerIdSchema, user.id);

      if (body.upload === 'failed') {
        await artifactsService.failUpload({ appId, artifactId, ownerId });
        return status(StatusMap['No Content'], undefined);
      }

      const artifact = await artifactsService.completeUpload({ appId, artifactId, ownerId });
      return status(StatusMap.OK, artifact);
    },
    {
      body: UpdateArtifactBodySchema,
      response: {
        [StatusMap.OK]: ArtifactSchema,
        [StatusMap['No Content']]: t.Void(),
      },
    },
  );
