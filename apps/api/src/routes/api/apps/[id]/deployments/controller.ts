import type { OwnerId } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { authPlugin } from '#lib/auth/plugin.ts';
import { AppDeploymentByIdController } from '#routes/api/apps/[id]/deployments/[deploymentId]/controller.ts';
import {
  CreateDeploymentBodySchema,
  DeploymentResponseSchema,
  ListDeploymentsResponseSchema,
} from '#routes/api/apps/[id]/deployments/model.ts';
import { AppParamsSchema } from '#routes/api/apps/[id]/model.ts';
import { DeploymentsServicePlugin, loggerPlugin } from '#services/plugins.ts';

export const AppDeploymentsController = new Elysia({ prefix: '/deployments' })
  .use(loggerPlugin('appDeploymentsController'))
  .use(authPlugin)
  .use(DeploymentsServicePlugin)
  .guard({ auth: true })
  .get(
    '/',
    async ({ deploymentsService, params, user, status }) => {
      const deployments = await deploymentsService.list({
        appId: params.id,
        ownerId: user.id as OwnerId,
      });
      return status(StatusMap.OK, { deployments });
    },
    {
      params: AppParamsSchema,
      response: { [StatusMap.OK]: ListDeploymentsResponseSchema },
    },
  )
  .post(
    '/',
    async ({ deploymentsService, params, body, user, status }) => {
      const deployment = await deploymentsService.create({
        appId: params.id,
        artifactId: body.artifactId,
        ownerId: user.id as OwnerId,
      });
      return status(StatusMap.Created, deployment);
    },
    {
      params: AppParamsSchema,
      body: CreateDeploymentBodySchema,
      response: { [StatusMap.Created]: DeploymentResponseSchema },
    },
  )
  .use(AppDeploymentByIdController);
