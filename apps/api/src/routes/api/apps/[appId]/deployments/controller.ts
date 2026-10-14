import { AppIdSchema } from '@repo/protocol';
import { publicSchema } from '@repo/typebox-extensions';
import { Value } from '@sinclair/typebox/value';
import { Elysia, StatusMap } from 'elysia';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { AuthCaller } from '#lib/auth/caller.ts';
import {
  CreateDeploymentBodySchema,
  DeploymentResponseSchema,
  ListDeploymentsResponseSchema,
} from '#routes/api/apps/[appId]/deployments/model.ts';
import { AuthPlugin, DeploymentsServicePlugin, loggerPlugin } from '#services/plugins.ts';

export const AppsAppIdDeploymentsController = new Elysia()
  .use(loggerPlugin('appsAppIdDeploymentsController'))
  .use(AuthPlugin)
  .use(DeploymentsServicePlugin)
  .get(
    '/apps/:appId/deployments',
    async function listDeployments({ deploymentsService, params, user, status }) {
      const deployments = await deploymentsService.list({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
      });
      return status(StatusMap.OK, { deployments });
    },
    {
      auth: { policies: [AuthCaller.AnonymousAccount, AuthCaller.RegisteredAccount] },
      response: { [StatusMap.OK]: publicSchema(ListDeploymentsResponseSchema) },
    },
  )
  .post(
    '/apps/:appId/deployments',
    async function createDeployment({
      deploymentsService,
      params,
      body: bodyInput,
      deploymentAccess,
      status,
    }) {
      const body = Value.Parse(CreateDeploymentBodySchema, bodyInput);
      const input = {
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: deploymentAccess.ownerId,
        source: body,
      };
      const deployment = deploymentAccess.deploymentGrant
        ? await deploymentsService.createWithDeploymentGrant({
            ...input,
            deploymentGrantId: deploymentAccess.deploymentGrant.id,
          })
        : await deploymentsService.createOrRollback({
            ...input,
            isAnonymous: deploymentAccess.isAnonymous,
          });
      return status(StatusMap.Created, deployment);
    },
    {
      auth: {
        policies: [
          AuthCaller.AnonymousAccount,
          AuthCaller.RegisteredAccount,
          AuthCaller.GitHubOidcDeployment,
        ],
      },
      body: publicSchema(CreateDeploymentBodySchema),
      response: { [StatusMap.Created]: publicSchema(DeploymentResponseSchema) },
    },
  );
