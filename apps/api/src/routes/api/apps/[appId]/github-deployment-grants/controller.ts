import { AppIdSchema } from '@repo/protocol';
import { publicSchema } from '@repo/typebox-extensions';
import { Value } from '@sinclair/typebox/value';
import { Elysia, StatusMap } from 'elysia';
import {
  ExchangeGitHubDeploymentGrantParamsSchema,
  ExchangeGitHubDeploymentGrantRequestSchema,
  ExchangeGitHubDeploymentGrantResponseSchema,
} from '#routes/api/apps/[appId]/github-deployment-grants/model.ts';
import { GitHubDeploymentGrantsServicePlugin } from '#services/plugins.ts';

export const AppsAppIdGitHubDeploymentGrantsController = new Elysia()
  .use(GitHubDeploymentGrantsServicePlugin)
  .post(
    '/apps/:appId/github-deployment-grants',
    async function exchangeGitHubDeploymentGrant({
      githubDeploymentGrantsService,
      params,
      body,
      status,
      set,
    }) {
      const grant = await githubDeploymentGrantsService.exchange({
        appId: Value.Parse(AppIdSchema, params.appId),
        identityToken: body.identityToken,
      });
      set.headers['cache-control'] = 'no-store';
      return status(StatusMap.Created, grant);
    },
    {
      params: publicSchema(ExchangeGitHubDeploymentGrantParamsSchema),
      body: publicSchema(ExchangeGitHubDeploymentGrantRequestSchema),
      response: { [StatusMap.Created]: publicSchema(ExchangeGitHubDeploymentGrantResponseSchema) },
    },
  );
