import type { OwnerId } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { authPlugin } from '#lib/auth/plugin.ts';
import {
  CreateDeploymentBodySchema,
  DeploymentResponseSchema,
  ListDeploymentsResponseSchema,
} from '#routes/api/apps/[appId]/deployments/model.ts';
import { AppParamsSchema } from '#routes/api/apps/[appId]/model.ts';
import { DeploymentsServicePlugin, loggerPlugin } from '#services/plugins.ts';

export const AppsAppIdDeploymentsController = new Elysia()
  .use(loggerPlugin('appsAppIdDeploymentsController'))
  .use(authPlugin)
  .use(DeploymentsServicePlugin)
  .guard({ auth: true })
  .get(
    '/apps/:appId/deployments',
    async ({ deploymentsService, params, user, status }) => {
      const deployments = await deploymentsService.list({
        appId: params.appId,
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
    '/apps/:appId/deployments',
    async ({ deploymentsService, params, body, user, status }) => {
      const deployment = await deploymentsService.createOrRollback({
        appId: params.appId,
        ownerId: user.id as OwnerId,
        source: body,
      });
      return status(StatusMap.Created, deployment);
    },
    {
      params: AppParamsSchema,
      body: CreateDeploymentBodySchema,
      response: { [StatusMap.Created]: DeploymentResponseSchema },
    },
  );
