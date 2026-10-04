import { AppIdSchema, DeployKeySchema, OwnerIdSchema, Value } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { Identity } from '#lib/auth/plugin.ts';
import {
  AddDeployKeyBodySchema,
  ListDeployKeysResponseSchema,
} from '#routes/api/apps/[appId]/deploy-keys/model.ts';
import { AuthPlugin, DeployKeysServicePlugin } from '#services/plugins.ts';

export const AppsAppIdDeployKeysController = new Elysia()
  .use(AuthPlugin)
  .use(DeployKeysServicePlugin)
  .guard({ auth: Identity.Required })
  .post(
    '/apps/:appId/deploy-keys',
    async ({ deployKeysService, params, body, user, status }) => {
      const deployKey = await deployKeysService.add({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        ...body,
      });
      return status(StatusMap.Created, deployKey);
    },
    {
      body: AddDeployKeyBodySchema,
      response: { [StatusMap.Created]: DeployKeySchema },
    },
  )
  .get(
    '/apps/:appId/deploy-keys',
    async ({ deployKeysService, params, user, status }) => {
      const deployKeys = await deployKeysService.list({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
      });
      return status(StatusMap.OK, { deployKeys });
    },
    { response: { [StatusMap.OK]: ListDeployKeysResponseSchema } },
  );
