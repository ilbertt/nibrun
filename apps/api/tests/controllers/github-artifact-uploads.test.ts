import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import { StatusMap } from 'elysia';
import { ArtifactSchema } from '#lib/api/artifact.ts';
import { ArtifactIdSchema, DeploymentGrantIdSchema } from '#lib/api/identifiers.ts';
import { createDeploymentGrantToken } from '#lib/deployment-grant-token.ts';
import { UnauthorizedError } from '#lib/errors.ts';
import { ORIGIN, send, sendJson } from '#tests/controllers/support/api.ts';
import {
  GRANT_APP_ID,
  GRANT_OWNER_ID,
  githubDeploymentGrant,
} from '#tests/support/github-deployment-grants.ts';

const { auth, ArtifactsServicePlugin, GitHubDeploymentGrantsServicePlugin } = await import(
  '#services/plugins.ts'
);
const artifacts = ArtifactsServicePlugin.decorator.artifactsService;
const grants = GitHubDeploymentGrantsServicePlugin.decorator.githubDeploymentGrantsService;
const SESSION_LIFETIME_MS = 60_000;
const FIXTURE_DIGEST = new Bun.CryptoHasher('sha256').update('binary').digest('hex');
const ARTIFACT_ID = Value.Parse(ArtifactIdSchema, 'artifact-1');
const URL = `${ORIGIN}/api/apps/${GRANT_APP_ID}/artifacts`;
const RESOURCE_URL = `${URL}/${ARTIFACT_ID}`;
const TOKEN = createDeploymentGrantToken({ ownerId: GRANT_OWNER_ID });
const HEADERS = { authorization: `Bearer ${TOKEN}` };
const BODY = { filename: 'server', sizeBytes: 1024 };
const UPLOAD = { artifactId: ARTIFACT_ID, url: 'https://storage.test/upload' };

function accountSession() {
  const now = new Date();
  return {
    user: {
      id: GRANT_OWNER_ID,
      name: 'Owner',
      email: 'owner@example.test',
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
      isAnonymous: false,
      image: null,
    },
    session: {
      id: 'session-1',
      userId: GRANT_OWNER_ID,
      token: 'session-token',
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS),
      ipAddress: null,
      userAgent: null,
    },
  };
}

afterEach(function restoreMocks() {
  mock.restore();
});

test('a GitHub deployment grant creates an upload without an account session', async () => {
  const grant = githubDeploymentGrant();
  const authenticate = spyOn(grants, 'authenticate').mockResolvedValue(grant);
  const session = spyOn(auth.api, 'getSession');
  const create = spyOn(artifacts, 'create').mockResolvedValue(UPLOAD);
  const response = await sendJson({ method: 'POST', url: URL, headers: HEADERS, body: BODY });
  expect(response.status).toBe(StatusMap.Created);
  expect(await response.json()).toEqual(UPLOAD);
  expect(authenticate).toHaveBeenCalledWith({ appId: GRANT_APP_ID, token: TOKEN });
  expect(create).toHaveBeenCalledWith({
    ...BODY,
    appId: GRANT_APP_ID,
    ownerId: GRANT_OWNER_ID,
    isAnonymous: false,
    deploymentGrant: { expires_at: grant.expires_at },
  });
  expect(session).not.toHaveBeenCalled();
});

test('completion and cancellation accept a fresh grant for the same app', async () => {
  const grant = githubDeploymentGrant();
  const create = spyOn(artifacts, 'create').mockResolvedValue(UPLOAD);
  const authenticate = spyOn(grants, 'authenticate').mockResolvedValue(grant);
  const created = await sendJson({ method: 'POST', url: URL, headers: HEADERS, body: BODY });
  expect(created.status).toBe(StatusMap.Created);
  expect(create).toHaveBeenCalled();
  const freshGrant = { ...grant, id: Value.Parse(DeploymentGrantIdSchema, 'grant-2') };
  const freshToken = createDeploymentGrantToken({ ownerId: GRANT_OWNER_ID });
  const freshHeaders = { authorization: `Bearer ${freshToken}` };
  authenticate.mockResolvedValue(freshGrant);
  const session = spyOn(auth.api, 'getSession');
  const artifact = Value.Parse(ArtifactSchema, {
    id: ARTIFACT_ID,
    appId: GRANT_APP_ID,
    digest: FIXTURE_DIGEST,
    sizeBytes: 1024,
    objectKey: 'sha256/server',
    originalFileName: 'server',
    createdAt: new Date().toISOString(),
  });
  const complete = spyOn(artifacts, 'completeUpload').mockResolvedValue(artifact);
  const fail = spyOn(artifacts, 'failUpload').mockResolvedValue(undefined);
  const completed = await sendJson({
    method: 'PATCH',
    url: RESOURCE_URL,
    headers: freshHeaders,
    body: { upload: 'complete' },
  });
  expect(completed.status).toBe(StatusMap.OK);
  expect(await completed.json()).toEqual(artifact);
  const canceled = await sendJson({
    method: 'PATCH',
    url: RESOURCE_URL,
    headers: freshHeaders,
    body: { upload: 'failed' },
  });
  expect(canceled.status).toBe(StatusMap['No Content']);
  const expected = {
    appId: GRANT_APP_ID,
    artifactId: ARTIFACT_ID,
    ownerId: GRANT_OWNER_ID,
  };
  expect(complete).toHaveBeenCalledWith(expected);
  expect(fail).toHaveBeenCalledWith(expected);
  expect(authenticate.mock.calls).toEqual([
    [{ appId: GRANT_APP_ID, token: TOKEN }],
    [{ appId: GRANT_APP_ID, token: freshToken }],
    [{ appId: GRANT_APP_ID, token: freshToken }],
  ]);
  expect(session).not.toHaveBeenCalled();
});

test('invalid or app-mismatched grants cannot fall back to a valid account cookie', async () => {
  spyOn(grants, 'authenticate').mockRejectedValue(new UnauthorizedError());
  const session = spyOn(auth.api, 'getSession').mockResolvedValue(accountSession());
  const create = spyOn(artifacts, 'create');
  const complete = spyOn(artifacts, 'completeUpload');
  const headers = { ...HEADERS, cookie: 'better-auth.session_token=valid-session' };
  for (const response of [
    await sendJson({ method: 'POST', url: URL, headers, body: BODY }),
    await sendJson({ method: 'POST', url: URL.replace('app-1', 'app-2'), headers, body: BODY }),
    await sendJson({ method: 'PATCH', url: RESOURCE_URL, headers, body: { upload: 'complete' } }),
  ]) {
    expect(response.status).toBe(StatusMap.Unauthorized);
  }
  expect(session).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
});

test('grants cannot use an account cookie to authorize artifact reads, app changes, or data imports', async () => {
  const authenticate = spyOn(grants, 'authenticate');
  const session = spyOn(auth.api, 'getSession').mockResolvedValue(accountSession());
  const headers = { ...HEADERS, cookie: 'better-auth.session_token=valid-session' };
  for (const response of [
    await send({ url: URL, headers }),
    await send({ url: RESOURCE_URL, headers }),
    await send({ url: `${ORIGIN}/api/apps/${GRANT_APP_ID}`, headers }),
    await sendJson({
      method: 'POST',
      url: `${ORIGIN}/api/apps/${GRANT_APP_ID}/imports`,
      headers,
      body: BODY,
    }),
  ]) {
    expect(response.status).toBe(StatusMap.Unauthorized);
  }
  expect(authenticate).not.toHaveBeenCalled();
  expect(session).not.toHaveBeenCalled();
});

test('account cookies and Better Auth bearer sessions still create account uploads', async () => {
  const session = spyOn(auth.api, 'getSession').mockResolvedValue(accountSession());
  const authenticate = spyOn(grants, 'authenticate');
  const create = spyOn(artifacts, 'create').mockResolvedValue(UPLOAD);
  const credentials: Record<string, string>[] = [
    { cookie: 'better-auth.session_token=account-token' },
    { authorization: 'Bearer account-token' },
  ];
  for (const headers of credentials) {
    const response = await sendJson({ method: 'POST', url: URL, headers, body: BODY });
    expect(response.status).toBe(StatusMap.Created);
  }
  expect(create).toHaveBeenLastCalledWith({
    ...BODY,
    appId: GRANT_APP_ID,
    ownerId: GRANT_OWNER_ID,
    isAnonymous: false,
    deploymentGrant: null,
  });
  expect(session).toHaveBeenCalledTimes(2);
  expect(authenticate).not.toHaveBeenCalled();
});

test('an empty bearer credential cannot fall back to an account cookie', async function rejectEmptyGrant() {
  spyOn(grants, 'authenticate').mockRejectedValue(new UnauthorizedError());
  const session = spyOn(auth.api, 'getSession').mockResolvedValue(accountSession());
  const create = spyOn(artifacts, 'create');
  const response = await sendJson({
    method: 'POST',
    url: URL,
    body: BODY,
    headers: { authorization: 'Bearer ', cookie: 'better-auth.session_token=valid-session' },
  });
  expect(response.status).toBe(StatusMap.Unauthorized);
  expect(session).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});

test('a grant cannot turn an upload request into a server-side download', async () => {
  spyOn(grants, 'authenticate').mockResolvedValue(githubDeploymentGrant());
  const response = await sendJson({
    method: 'POST',
    url: URL,
    headers: HEADERS,
    body: { url: 'https://releases.test/server' },
  });
  expect(response.status).toBe(StatusMap.Forbidden);
});
