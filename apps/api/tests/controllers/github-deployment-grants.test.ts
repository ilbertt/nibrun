import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { TimestampSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { StatusMap } from 'elysia';
import { GITHUB_IDENTITY_TOKEN_MAX_LENGTH } from '#lib/deployment-grant-policy.ts';
import { createDeploymentGrantToken } from '#lib/deployment-grant-token.ts';
import { UnauthorizedError } from '#lib/errors.ts';
import { ORIGIN, sendJson } from '#tests/controllers/support/api.ts';
import { GRANT_APP_ID, GRANT_ID, GRANT_OWNER_ID } from '#tests/support/github-deployment-grants.ts';

const { auth, GitHubDeploymentGrantsServicePlugin } = await import('#services/plugins.ts');
const URL = `${ORIGIN}/api/apps/${GRANT_APP_ID}/github-deployment-grants`;
const IDENTITY_TOKEN = 'github-identity-token';

afterEach(function restoreMocks() {
  mock.restore();
});

test('OIDC exchange uses GitHub identity without authenticating an account session and forbids response caching', async () => {
  const accountSession = spyOn(auth.api, 'getSession');
  const grant = {
    id: GRANT_ID,
    token: createDeploymentGrantToken({ ownerId: GRANT_OWNER_ID }),
    expiresAt: Value.Parse(TimestampSchema, new Date().toISOString()),
  };
  const exchange = spyOn(
    GitHubDeploymentGrantsServicePlugin.decorator.githubDeploymentGrantsService,
    'exchange',
  ).mockResolvedValue(grant);
  const response = await sendJson({
    method: 'POST',
    url: URL,
    body: { identityToken: IDENTITY_TOKEN },
  });
  expect(response.status).toBe(StatusMap.Created);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual(grant);
  expect(exchange).toHaveBeenCalledWith({ appId: GRANT_APP_ID, identityToken: IDENTITY_TOKEN });
  expect(accountSession).not.toHaveBeenCalled();
});

test('unauthorized exchange returns no deployment token', async () => {
  spyOn(
    GitHubDeploymentGrantsServicePlugin.decorator.githubDeploymentGrantsService,
    'exchange',
  ).mockRejectedValue(new UnauthorizedError('Untrusted GitHub identity.'));
  const response = await sendJson({
    method: 'POST',
    url: URL,
    body: { identityToken: IDENTITY_TOKEN },
  });
  expect(response.status).toBe(StatusMap.Unauthorized);
  expect(await response.json()).toEqual({ error: 'Untrusted GitHub identity.' });
});

test('missing, oversized, and unexpected token request fields never reach exchange', async () => {
  const exchange = spyOn(
    GitHubDeploymentGrantsServicePlugin.decorator.githubDeploymentGrantsService,
    'exchange',
  );
  for (const body of [
    {},
    { identityToken: '' },
    { identityToken: 'x'.repeat(GITHUB_IDENTITY_TOKEN_MAX_LENGTH + 1) },
    { identityToken: IDENTITY_TOKEN, ownerId: GRANT_OWNER_ID },
  ]) {
    const response = await sendJson({ method: 'POST', url: URL, body });
    expect(response.status).toBe(StatusMap['Bad Request']);
  }
  expect(exchange).not.toHaveBeenCalled();
});
