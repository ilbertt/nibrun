import { afterEach, beforeAll, expect, mock, spyOn, test } from 'bun:test';
import { StatusMap } from 'elysia';
import type { DeploymentTokenResource } from '#lib/api/deployment-token.ts';
import {
  DEPLOYMENT_TOKEN_PERMISSION,
  shortLivedDeploymentTokenConfiguration,
} from '#lib/auth/deployment-api-keys.ts';
import {
  DEPLOYMENT_TOKEN_LIFETIME_SECONDS,
  GITHUB_IDENTITY_TOKEN_MAX_LENGTH,
} from '#lib/deployment-grant-policy.ts';
import { UnauthorizedError } from '#lib/errors.ts';
import { GitHubDeploymentGrantsService } from '#services/github-deployment-grants.service.ts';
import { ORIGIN, send } from '#tests/controllers/support/api.ts';
import {
  GitHubOidcProviderFixture,
  githubClaims,
  type SigningKey,
  signingKey,
  signToken,
} from '#tests/support/github-actions-oidc.ts';
import {
  GRANT_APP_ID,
  GRANT_ID,
  GRANT_OWNER_ID,
  githubDeploymentGrant,
  StubGitHubDeploymentGrantsRepository,
} from '#tests/support/github-deployment-grants.ts';

const { auth, GitHubDeploymentGrantsServicePlugin } = await import('#services/plugins.ts');
const TOKEN_URL = `${ORIGIN}/api/apps/${GRANT_APP_ID}/deployment-tokens`;
const MS_PER_SECOND = 1000;
let key: SigningKey;

beforeAll(async function initializeKeys() {
  key = await signingKey({ kid: 'deployment-exchange' });
});
afterEach(function restoreMocks() {
  mock.restore();
});

function exchangeRequest(identityToken: string) {
  return send({
    method: 'POST',
    url: TOKEN_URL,
    headers: { authorization: `Bearer ${identityToken}` },
  });
}

function installVerifiedExchange() {
  const grantsRepo = new StubGitHubDeploymentGrantsRepository();
  const identityProvider = new GitHubOidcProviderFixture([key.jwk]);
  const grantsService = new GitHubDeploymentGrantsService({
    identityService: identityProvider.service(),
    grantsRepo,
  });
  const exchange = spyOn(
    GitHubDeploymentGrantsServicePlugin.decorator.githubDeploymentGrantsService,
    'exchange',
  ).mockImplementation(function exchangeThroughVerifier(input) {
    return grantsService.exchange(input);
  });
  return { grantsRepo, exchange };
}

test.each(['refs/heads/main', 'refs/tags/v2026.10.4'])(
  'API-verified GitHub proof from %s becomes a Better Auth app-scoped token without an account session',
  async (ref) => {
    const { grantsRepo, exchange } = installVerifiedExchange();
    const accountSession = spyOn(auth.api, 'getSession');
    const response = await exchangeRequest(
      await signToken({
        key,
        claims: {
          ...githubClaims(),
          ref,
          sub: `repo:acme/backend:ref:${ref}`,
          workflow_ref: `acme/backend/.github/workflows/deploy.yml@${ref}`,
        },
      }),
    );
    expect(response.status).toBe(StatusMap.Created);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const credential = (await response.json()) as DeploymentTokenResource;
    const expiresAt = new Date(credential.expiresAt);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(grantsRepo.grant!.expires_at.getTime());
    expect(expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + DEPLOYMENT_TOKEN_LIFETIME_SECONDS * MS_PER_SECOND,
    );
    const verification = await auth.api.verifyApiKey({
      body: {
        configId: shortLivedDeploymentTokenConfiguration.configId,
        key: credential.token,
        permissions: { [GRANT_APP_ID]: [DEPLOYMENT_TOKEN_PERMISSION] },
      },
    });
    expect(verification.valid).toBe(true);
    expect(verification.key).toMatchObject({
      referenceId: GRANT_OWNER_ID,
      metadata: { grantId: GRANT_ID },
      expiresAt,
    });
    expect(
      (
        await auth.api.verifyApiKey({
          body: {
            configId: shortLivedDeploymentTokenConfiguration.configId,
            key: credential.token,
            permissions: { 'another-app': [DEPLOYMENT_TOKEN_PERMISSION] },
          },
        })
      ).valid,
    ).toBe(false);
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(accountSession).not.toHaveBeenCalled();
  },
);

test('invalid authentication cannot reach GitHub trust or issue credentials', async () => {
  const { exchange } = installVerifiedExchange();
  for (const authorization of [
    undefined,
    'Basic invalid',
    'Bearer ',
    `Bearer ${'x'.repeat(GITHUB_IDENTITY_TOKEN_MAX_LENGTH + 1)}`,
  ]) {
    const response = await send({
      method: 'POST',
      url: TOKEN_URL,
      headers: authorization === undefined ? {} : { authorization },
    });
    expect(response.status).toBe(StatusMap.Unauthorized);
  }
  expect(exchange).not.toHaveBeenCalled();
});

test('bad signatures and untrusted workflows cannot issue credentials', async () => {
  const { grantsRepo } = installVerifiedExchange();
  const outsider = await signingKey({ kid: key.kid });
  for (const identityToken of [
    await signToken({ key: outsider }),
    await signToken({
      key,
      claims: {
        ...githubClaims(),
        workflow_ref: 'acme/backend/.github/workflows/other.yml@refs/heads/main',
      },
    }),
  ]) {
    const response = await exchangeRequest(identityToken);
    expect(response.status).toBe(StatusMap.Unauthorized);
    expect(await response.json()).not.toHaveProperty('token');
  }
  expect(grantsRepo.writes).toHaveLength(0);
});

test('replay does not issue another credential', async () => {
  spyOn(
    GitHubDeploymentGrantsServicePlugin.decorator.githubDeploymentGrantsService,
    'exchange',
  ).mockRejectedValue(
    new UnauthorizedError('GitHub identity token has already been exchanged for this app.'),
  );
  const issuance = spyOn(auth.api, 'createApiKey');
  expect((await exchangeRequest(await signToken({ key }))).status).toBe(StatusMap.Unauthorized);
  expect(issuance).not.toHaveBeenCalled();
});

test('an expired grant cannot issue a credential', async () => {
  spyOn(
    GitHubDeploymentGrantsServicePlugin.decorator.githubDeploymentGrantsService,
    'exchange',
  ).mockResolvedValue({ ...githubDeploymentGrant(), expires_at: new Date(0) });
  expect((await exchangeRequest(await signToken({ key }))).status).toBe(StatusMap.Unauthorized);
});

test('deployment key creation and updates are unavailable over HTTP', async () => {
  for (const path of ['create', 'update']) {
    const response = await send({
      method: 'POST',
      url: `${ORIGIN}/api/auth/api-key/${path}`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        configId: shortLivedDeploymentTokenConfiguration.configId,
      }),
    });
    expect(response.status).toBe(StatusMap.Forbidden);
  }
});

test('a grant too close to expiry cannot issue a token', async () => {
  spyOn(
    GitHubDeploymentGrantsServicePlugin.decorator.githubDeploymentGrantsService,
    'exchange',
  ).mockResolvedValue({
    ...githubDeploymentGrant(),
    expires_at: new Date(Date.now() + MS_PER_SECOND),
  });
  const issuance = spyOn(auth.api, 'createApiKey');
  expect((await exchangeRequest(await signToken({ key }))).status).toBe(StatusMap.Unauthorized);
  expect(issuance).not.toHaveBeenCalled();
});
