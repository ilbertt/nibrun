import { AppIdSchema } from '@repo/protocol';
import { publicSchema } from '@repo/typebox-extensions';
import { Value } from '@sinclair/typebox/value';
import { Elysia, StatusMap } from 'elysia';
import {
  DeploymentTokenResponseSchema,
  IssueDeploymentTokenParamsSchema,
} from '#routes/api/apps/[appId]/deployment-tokens/model.ts';
import { GitHubDeploymentTokensServicePlugin } from '#services/plugins.ts';

export const AppsAppIdDeploymentTokensController = new Elysia()
  .use(GitHubDeploymentTokensServicePlugin)
  .post(
    '/apps/:appId/deployment-tokens',
    async function issueDeploymentToken({
      githubDeploymentTokensService,
      params,
      request,
      set,
      status,
    }) {
      const credential = await githubDeploymentTokensService.issue({
        appId: Value.Parse(AppIdSchema, params.appId),
        headers: request.headers,
      });
      set.headers['cache-control'] = 'no-store';
      return status(StatusMap.Created, credential);
    },
    {
      params: publicSchema(IssueDeploymentTokenParamsSchema),
      response: { [StatusMap.Created]: publicSchema(DeploymentTokenResponseSchema) },
    },
  );
