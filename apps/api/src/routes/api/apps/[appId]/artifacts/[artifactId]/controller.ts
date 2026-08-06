import {
  AppIdSchema,
  ArtifactIdSchema,
  ArtifactSchema,
  OwnerIdSchema,
  Value,
} from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { authPlugin } from '#lib/auth/plugin.ts';
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
  );
