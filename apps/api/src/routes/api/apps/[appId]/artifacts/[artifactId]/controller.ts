import { AppIdSchema, Value } from '@repo/protocol';
import { publicSchema } from '@repo/typebox-extensions';
import { Elysia, StatusMap, t } from 'elysia';
import { ArtifactSchema } from '#lib/api/artifact.ts';
import { ArtifactIdSchema, OwnerIdSchema } from '#lib/api/identifiers.ts';
import { Identity } from '#lib/auth/plugin.ts';
import { UpdateArtifactBodySchema } from '#routes/api/apps/[appId]/artifacts/model.ts';
import { ArtifactsServicePlugin, AuthPlugin, loggerPlugin } from '#services/plugins.ts';

export const AppsAppIdArtifactsArtifactIdController = new Elysia()
  .use(loggerPlugin('appsAppIdArtifactsArtifactIdController'))
  .use(AuthPlugin)
  .use(ArtifactsServicePlugin)
  .guard({ auth: Identity.Optional })
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
      response: { [StatusMap.OK]: publicSchema(ArtifactSchema) },
    },
  )
  .patch(
    '/apps/:appId/artifacts/:artifactId',
    async ({ artifactsService, params, body: bodyInput, user, status }) => {
      const body = Value.Parse(UpdateArtifactBodySchema, bodyInput);
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
      body: publicSchema(UpdateArtifactBodySchema),
      response: {
        [StatusMap.OK]: publicSchema(ArtifactSchema),
        [StatusMap['No Content']]: t.Void(),
      },
    },
  );
