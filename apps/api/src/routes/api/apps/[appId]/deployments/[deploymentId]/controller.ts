import { AppIdSchema, DeploymentIdSchema, OwnerIdSchema, Value } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { authPlugin } from '#lib/auth/plugin.ts';
import {
  DeploymentParamsSchema,
  DeploymentResponseSchema,
} from '#routes/api/apps/[appId]/deployments/model.ts';
import { DeploymentsServicePlugin, loggerPlugin } from '#services/plugins.ts';

export const AppsAppIdDeploymentsDeploymentIdController = new Elysia()
  .use(loggerPlugin('appsAppIdDeploymentsDeploymentIdController'))
  .use(authPlugin)
  .use(DeploymentsServicePlugin)
  .guard({ auth: true })
  .get(
    '/apps/:appId/deployments/:deploymentId',
    async ({ deploymentsService, params, user, status }) => {
      const deployment = await deploymentsService.get({
        appId: Value.Parse(AppIdSchema, params.appId),
        deploymentId: Value.Parse(DeploymentIdSchema, params.deploymentId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
      });
      return status(StatusMap.OK, deployment);
    },
    {
      params: DeploymentParamsSchema,
      response: { [StatusMap.OK]: DeploymentResponseSchema },
    },
  );
