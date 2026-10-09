import { beforeAll, expect, test } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import { DeploymentGrantSchema } from '#lib/api/deployment-grant.ts';
import { DEPLOYMENT_GRANT_LIFETIME_MS } from '#lib/deployment-grant-policy.ts';
import { deploymentGrantTokenHash } from '#lib/deployment-grant-token.ts';
import { UnauthorizedError } from '#lib/errors.ts';
import { GitHubDeploymentGrantsService } from '#services/github-deployment-grants.service.ts';
import {
  GitHubOidcProviderFixture,
  githubClaims,
  type SigningKey,
  signingKey,
  signToken,
} from '#tests/support/github-actions-oidc.ts';
import {
  GRANT_APP_ID,
  GRANT_OWNER_ID,
  StubGitHubDeploymentGrantsRepository,
} from '#tests/support/github-deployment-grants.ts';

let key: SigningKey;
beforeAll(async function generateSigningKey() {
  key = await signingKey({ kid: 'deployment-grants' });
});

function build() {
  const grantsRepo = new StubGitHubDeploymentGrantsRepository();
  const provider = new GitHubOidcProviderFixture([key.jwk]);
  const service = new GitHubDeploymentGrantsService({
    identityService: provider.service(),
    grantsRepo,
  });
  return { service, grantsRepo, provider };
}

test('verified GitHub identity receives an app and run-attempt scoped grant with only its hash persisted', async () => {
  const { service, grantsRepo } = build();
  const identity = { ...githubClaims(), repository: 'ACME/Backend', run_attempt: '2' };
  const identityToken = await signToken({ key, claims: identity });
  const before = Date.now();
  const grant = await service.exchange({ appId: GRANT_APP_ID, identityToken });
  expect(Value.Check(DeploymentGrantSchema, grant)).toBe(true);
  const expiresAt = new Date(grant.expiresAt).getTime();
  expect(expiresAt).toBeGreaterThanOrEqual(before + DEPLOYMENT_GRANT_LIFETIME_MS);
  expect(expiresAt).toBeLessThanOrEqual(Date.now() + DEPLOYMENT_GRANT_LIFETIME_MS);
  expect(grantsRepo.lookups).toEqual([{ appId: GRANT_APP_ID, repository: 'acme/backend' }]);
  expect(grantsRepo.writes[0]).toMatchObject({
    appId: GRANT_APP_ID,
    ownerId: GRANT_OWNER_ID,
    identity,
    tokenHash: deploymentGrantTokenHash(grant.token),
  });
  expect(JSON.stringify(grantsRepo.writes)).not.toContain(grant.token);
  expect(JSON.stringify(grantsRepo.writes)).not.toContain(identityToken);
  const authorized = await service.authenticate({ appId: GRANT_APP_ID, token: grant.token });
  expect(authorized.identity).toEqual(identity);
  expect(authorized.owner_id).toBe(GRANT_OWNER_ID);
});

test('invalid signatures cannot reach the trust lookup', async () => {
  const { service, grantsRepo } = build();
  const outsider = await signingKey({ kid: key.kid });
  const identityToken = await signToken({ key: outsider });
  await expect(service.exchange({ appId: GRANT_APP_ID, identityToken })).rejects.toBeInstanceOf(
    UnauthorizedError,
  );
  expect(grantsRepo.lookups).toHaveLength(0);
  expect(grantsRepo.writes).toHaveLength(0);
});

test.each([
  { repository: 'stranger/backend' },
  { workflow_ref: 'acme/backend/.github/workflows/other.yml@refs/heads/main' },
  { ref: 'refs/heads/feature' },
  { event_name: 'pull_request' },
])('untrusted workflow context %j cannot mint a grant', async (override) => {
  const { service, grantsRepo } = build();
  const identityToken = await signToken({ key, claims: { ...githubClaims(), ...override } });
  await expect(service.exchange({ appId: GRANT_APP_ID, identityToken })).rejects.toBeInstanceOf(
    UnauthorizedError,
  );
  expect(grantsRepo.writes).toHaveLength(0);
});

test('a missing rule and a mismatched protected environment both refuse exchange', async () => {
  const { service, grantsRepo } = build();
  if (!grantsRepo.trust) {
    throw new Error('Missing fixture trust');
  }
  grantsRepo.trust.environment = 'production';
  const identityToken = await signToken({ key });
  await expect(service.exchange({ appId: GRANT_APP_ID, identityToken })).rejects.toBeInstanceOf(
    UnauthorizedError,
  );
  grantsRepo.trust = null;
  await expect(service.exchange({ appId: GRANT_APP_ID, identityToken })).rejects.toBeInstanceOf(
    UnauthorizedError,
  );
  expect(grantsRepo.writes).toHaveLength(0);
});

test('a changed rule detected during insertion never returns the generated token', async () => {
  const { service, grantsRepo } = build();
  grantsRepo.writable = false;
  await expect(
    service.exchange({ appId: GRANT_APP_ID, identityToken: await signToken({ key }) }),
  ).rejects.toBeInstanceOf(UnauthorizedError);
  expect(grantsRepo.writes).toHaveLength(1);
});

test('ordinary session tokens, GitHub JWTs, malformed separators, and owner substitutions cannot authenticate', async () => {
  const { service, grantsRepo } = build();
  const identityToken = await signToken({ key });
  const grant = await service.exchange({ appId: GRANT_APP_ID, identityToken });
  for (const token of [
    '',
    'ordinary-session-token',
    identityToken,
    grant.token.replace('.', '!'),
  ]) {
    await expect(service.authenticate({ appId: GRANT_APP_ID, token })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  }
  expect(grantsRepo.authentications).toHaveLength(0);
  await expect(
    service.authenticate({
      appId: GRANT_APP_ID,
      token: grant.token.replace(GRANT_OWNER_ID, 'other-owner'),
    }),
  ).rejects.toBeInstanceOf(UnauthorizedError);
  expect(grantsRepo.authentications).toHaveLength(1);
});
