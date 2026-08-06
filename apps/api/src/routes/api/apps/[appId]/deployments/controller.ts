import { AppIdSchema, OwnerIdSchema, Value } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { authPlugin } from '#lib/auth/plugin.ts';
import {
  CreateDeploymentBodySchema,
  DeploymentResponseSchema,
  ListDeploymentsResponseSchema,
} from '#routes/api/apps/[appId]/deployments/model.ts';
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
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
      });
      return status(StatusMap.OK, { deployments });
    },
    {
      response: { [StatusMap.OK]: ListDeploymentsResponseSchema },
    },
  )
  .post(
    '/apps/:appId/deployments',
    async ({ deploymentsService, params, body, user, status }) => {
      const deployment = await deploymentsService.createOrRollback({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        source: body,
      });
      return status(StatusMap.Created, deployment);
    },
    {
      body: CreateDeploymentBodySchema,
      response: { [StatusMap.Created]: DeploymentResponseSchema },
    },
  );
