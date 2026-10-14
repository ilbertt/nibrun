import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import { StatusMap } from 'elysia';
import { UnauthorizedError } from '#lib/errors.ts';
import { DeploymentResponseSchema } from '#routes/api/apps/[appId]/deployments/model.ts';
import { ORIGIN, sendJson } from '#tests/controllers/support/api.ts';
import { DEFAULT_CONFIG } from '#tests/services/support/fixtures.ts';
import { deploymentToken } from '#tests/support/deployment-tokens.ts';
import {
  GRANT_APP_ID,
  GRANT_OWNER_ID,
  githubDeploymentGrant,
} from '#tests/support/github-deployment-grants.ts';

const { auth, DeploymentsServicePlugin, GitHubDeploymentGrantsServicePlugin } = await import(
  '#services/plugins.ts'
);
const deployments = DeploymentsServicePlugin.decorator.deploymentsService;
const grants = GitHubDeploymentGrantsServicePlugin.decorator.githubDeploymentGrantsService;
const URL = `${ORIGIN}/api/apps/${GRANT_APP_ID}/deployments`;
const TOKEN = await deploymentToken({});
const HEADERS = { authorization: `Bearer ${TOKEN}` };
const BODY = { artifactId: 'artifact-1' };

beforeEach(function prepareAuthentication() {
  spyOn(auth.api, 'getSession').mockResolvedValue(null);
});

afterEach(function restoreMocks() {
  mock.restore();
});

test('a verified app grant can deploy a binary through the existing service', async () => {
  spyOn(grants, 'authenticate').mockResolvedValue(githubDeploymentGrant());
  const created = Value.Parse(DeploymentResponseSchema, {
    id: 'deployment-1',
    appId: GRANT_APP_ID,
    artifactId: 'artifact-1',
    config: DEFAULT_CONFIG,
    state: 'pending',
    createdAt: new Date().toISOString(),
    restartCount: 0,
  });
  const create = spyOn(deployments, 'createWithDeploymentGrant').mockResolvedValue(created);
  const response = await sendJson({ method: 'POST', url: URL, headers: HEADERS, body: BODY });
  expect(response.status).toBe(StatusMap.Created);
  expect(create).toHaveBeenCalledWith({
    appId: GRANT_APP_ID,
    ownerId: GRANT_OWNER_ID,
    source: BODY,
  });
});

test('grant credentials cannot list deployments or read an existing deployment', async () => {
  const authenticate = spyOn(grants, 'authenticate');
  const list = spyOn(deployments, 'list');
  const get = spyOn(deployments, 'get');
  for (const url of [URL, `${URL}/deployment-1`]) {
    expect((await sendJson({ url, headers: HEADERS })).status).toBe(StatusMap.Unauthorized);
  }
  expect(authenticate).not.toHaveBeenCalled();
  expect(list).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled();
});

test('stale workflow authorization is rejected before deployment creation', async () => {
  spyOn(grants, 'authenticate').mockRejectedValue(
    new UnauthorizedError('Invalid deployment grant.'),
  );
  const create = spyOn(deployments, 'createWithDeploymentGrant');
  const response = await sendJson({ method: 'POST', url: URL, headers: HEADERS, body: BODY });
  expect(response.status).toBe(StatusMap.Unauthorized);
  expect(create).not.toHaveBeenCalled();
});

test('a grant for another app cannot create a deployment', async () => {
  const create = spyOn(deployments, 'createWithDeploymentGrant');
  const response = await sendJson({
    method: 'POST',
    url: `${ORIGIN}/api/apps/other-app/deployments`,
    headers: HEADERS,
    body: BODY,
  });
  expect(response.status).toBe(StatusMap.Unauthorized);
  expect(create).not.toHaveBeenCalled();
});
