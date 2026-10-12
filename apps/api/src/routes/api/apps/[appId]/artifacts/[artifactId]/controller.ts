import { AppIdSchema } from '@repo/protocol';
import { publicSchema } from '@repo/typebox-extensions';
import { Value } from '@sinclair/typebox/value';
import { Elysia, StatusMap, t } from 'elysia';
import { ArtifactSchema } from '#lib/api/artifact.ts';
import { ArtifactIdSchema, OwnerIdSchema } from '#lib/api/identifiers.ts';
import { Identity } from '#lib/auth/identity.ts';
import { UpdateArtifactBodySchema } from '#routes/api/apps/[appId]/artifacts/model.ts';
import { ArtifactsServicePlugin, AuthPlugin, loggerPlugin } from '#services/plugins.ts';

export const AppsAppIdArtifactsArtifactIdController = new Elysia()
  .use(loggerPlugin('appsAppIdArtifactsArtifactIdController'))
  .use(AuthPlugin)
  .use(ArtifactsServicePlugin)
  .get(
    '/apps/:appId/artifacts/:artifactId',
    async function getArtifact({ artifactsService, params, user, status }) {
      const artifact = await artifactsService.get({
        appId: Value.Parse(AppIdSchema, params.appId),
        artifactId: Value.Parse(ArtifactIdSchema, params.artifactId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
      });
      return status(StatusMap.OK, artifact);
    },
    {
      auth: Identity.Optional,
      response: { [StatusMap.OK]: publicSchema(ArtifactSchema) },
    },
  )
  .patch(
    '/apps/:appId/artifacts/:artifactId',
    async function reportArtifactUpload({
      artifactsService,
      params,
      body: bodyInput,
      deploymentAccess,
      status,
    }) {
      const body = Value.Parse(UpdateArtifactBodySchema, bodyInput);
      const appId = Value.Parse(AppIdSchema, params.appId);
      const artifactId = Value.Parse(ArtifactIdSchema, params.artifactId);

      if (body.upload === 'failed') {
        await artifactsService.failUpload({ appId, artifactId, ownerId: deploymentAccess.ownerId });
        return status(StatusMap['No Content'], undefined);
      }

      const artifact = await artifactsService.completeUpload({
        appId,
        artifactId,
        ownerId: deploymentAccess.ownerId,
      });
      return status(StatusMap.OK, artifact);
    },
    {
      appDeploymentAuth: true,
      body: publicSchema(UpdateArtifactBodySchema),
      response: {
        [StatusMap.OK]: publicSchema(ArtifactSchema),
        [StatusMap['No Content']]: t.Void(),
      },
    },
  );
