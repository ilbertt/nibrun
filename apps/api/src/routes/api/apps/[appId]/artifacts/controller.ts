import { AppIdSchema } from '@repo/protocol';
import { publicSchema } from '@repo/typebox-extensions';
import { Value } from '@sinclair/typebox/value';
import { Elysia, StatusMap } from 'elysia';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { AuthCaller } from '#lib/auth/caller.ts';
import {
  CreateArtifactBodySchema,
  CreateArtifactResponseSchema,
  ListArtifactsResponseSchema,
} from '#routes/api/apps/[appId]/artifacts/model.ts';
import { ArtifactsServicePlugin, AuthPlugin, loggerPlugin } from '#services/plugins.ts';

export const AppsAppIdArtifactsController = new Elysia()
  .use(loggerPlugin('appsAppIdArtifactsController'))
  .use(AuthPlugin)
  .use(ArtifactsServicePlugin)
  .get(
    '/apps/:appId/artifacts',
    async function listArtifacts({ artifactsService, params, user, status }) {
      const artifacts = await artifactsService.list({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
      });
      return status(StatusMap.OK, { artifacts });
    },
    {
      auth: { policies: [AuthCaller.AnonymousAccount, AuthCaller.RegisteredAccount] },
      response: { [StatusMap.OK]: publicSchema(ListArtifactsResponseSchema) },
    },
  )
  .post(
    '/apps/:appId/artifacts',
    async function createArtifact({
      artifactsService,
      params,
      body: bodyInput,
      deploymentAccess,
      status,
    }) {
      const body = Value.Parse(CreateArtifactBodySchema, bodyInput);
      const appId = Value.Parse(AppIdSchema, params.appId);
      const created =
        'url' in body
          ? await artifactsService.createFromUrl({
              appId,
              ...deploymentAccess,
              url: body.url,
              filename: undefined,
              sha256: body.sha256,
            })
          : await artifactsService.create({
              appId,
              ...deploymentAccess,
              filename: body.filename,
              sizeBytes: body.sizeBytes,
            });
      return status(StatusMap.Created, created);
    },
    {
      auth: {
        policies: [
          AuthCaller.AnonymousAccount,
          AuthCaller.RegisteredAccount,
          AuthCaller.GitHubOidcDeployment,
        ],
      },
      body: publicSchema(CreateArtifactBodySchema),
      response: { [StatusMap.Created]: publicSchema(CreateArtifactResponseSchema) },
    },
  );
