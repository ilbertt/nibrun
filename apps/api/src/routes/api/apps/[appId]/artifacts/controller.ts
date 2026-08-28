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
  // Created rather than OK: the artifact exists from here on. What is left to do with it is what
  // differs — an upload is told where to send the bytes, while a url has already been followed by
  // the time this answers, and the request the caller is waiting on is the one that fetched it.
  .post(
    '/apps/:appId/artifacts',
    async ({ artifactsService, params, body, user, status }) => {
      const appId = Value.Parse(AppIdSchema, params.appId);
      const ownerId = Value.Parse(OwnerIdSchema, user.id);
      const created =
        'url' in body
          ? await artifactsService.createFromUrl({ appId, ownerId, url: body.url })
          : await artifactsService.create({
              appId,
              ownerId,
              filename: body.filename,
              sizeBytes: body.sizeBytes,
            });
      return status(StatusMap.Created, created);
    },
    {
      body: CreateArtifactBodySchema,
      response: { [StatusMap.Created]: CreateArtifactResponseSchema },
    },
  );
