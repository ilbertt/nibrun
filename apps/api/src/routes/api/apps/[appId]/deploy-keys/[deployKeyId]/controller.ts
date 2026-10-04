import { AppIdSchema, DeployKeyIdSchema, OwnerIdSchema, Value } from '@repo/protocol';
import { Elysia, StatusMap, t } from 'elysia';
import { Identity } from '#lib/auth/plugin.ts';
import { AuthPlugin, DeployKeysServicePlugin } from '#services/plugins.ts';

export const AppsAppIdDeployKeysDeployKeyIdController = new Elysia()
  .use(AuthPlugin)
  .use(DeployKeysServicePlugin)
  .guard({ auth: Identity.Required })
  .delete(
    '/apps/:appId/deploy-keys/:deployKeyId',
    async ({ deployKeysService, params, user, status }) => {
      await deployKeysService.remove({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        deployKeyId: Value.Parse(DeployKeyIdSchema, params.deployKeyId),
      });
      return status(StatusMap['No Content'], undefined);
    },
    { response: { [StatusMap['No Content']]: t.Void() } },
  );
