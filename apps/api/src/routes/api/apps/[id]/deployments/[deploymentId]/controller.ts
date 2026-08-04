import type { OwnerId } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { authPlugin } from '#lib/auth/plugin.ts';
import {
  DeploymentParamsSchema,
  DeploymentResponseSchema,
  UpdateDeploymentBodySchema,
} from '#routes/api/apps/[id]/deployments/model.ts';
import { DeploymentsServicePlugin, loggerPlugin } from '#services/plugins.ts';

export const AppDeploymentByIdController = new Elysia({ prefix: '/:deploymentId' })
  .use(loggerPlugin('appDeploymentByIdController'))
  .use(authPlugin)
  .use(DeploymentsServicePlugin)
  .guard({ auth: true })
  .get(
    '/',
    async ({ deploymentsService, params, user, status }) => {
      const deployment = await deploymentsService.get({
        appId: params.id,
        deploymentId: params.deploymentId,
        ownerId: user.id as OwnerId,
      });
      return status(StatusMap.OK, deployment);
    },
    {
      params: DeploymentParamsSchema,
      response: { [StatusMap.OK]: DeploymentResponseSchema },
    },
  )
  .patch(
    '/',
    async ({ deploymentsService, params, user, status }) => {
      const deployment = await deploymentsService.activate({
        appId: params.id,
        deploymentId: params.deploymentId,
        ownerId: user.id as OwnerId,
      });
      return status(StatusMap.OK, deployment);
    },
    {
      params: DeploymentParamsSchema,
      body: UpdateDeploymentBodySchema,
      response: { [StatusMap.OK]: DeploymentResponseSchema },
    },
  );
