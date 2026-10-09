import { beforeAll, describe, expect, test } from 'bun:test';
import type { JWTPayload } from 'jose';
import { UnauthorizedError } from '#lib/errors.ts';
import { GITHUB_ACTIONS_OIDC_AUDIENCE } from '#lib/github-actions-oidc.ts';
import {
  GitHubOidcProviderFixture,
  githubClaims,
  type SigningKey,
  signingKey,
  signToken,
} from '#tests/support/github-actions-oidc.ts';

const MS_PER_SECOND = 1000;
const FUTURE_NOT_BEFORE_SECONDS = 600;
const FUTURE_ISSUED_SECONDS = 60;
const FRACTIONAL_SECOND = 0.5;
const SHA_LENGTH = 40;

let trustedKey: SigningKey;
let outsiderKey: SigningKey;

beforeAll(async () => {
  trustedKey = await signingKey({ kid: 'trusted' });
  outsiderKey = await signingKey({ kid: 'trusted' });
});

function service() {
  return new GitHubOidcProviderFixture([trustedKey.jwk]).service();
}

describe('GitHub Actions OIDC verification', () => {
  test('returns signed deployment identity and provenance claims', async () => {
    const claims = githubClaims();
    expect(await service().verify({ token: await signToken({ key: trustedKey, claims }) })).toEqual(
      claims,
    );
  });

  test('accepts audience arrays containing the nibrun audience', async () => {
    const claims = { ...githubClaims(), aud: ['other', GITHUB_ACTIONS_OIDC_AUDIENCE] };
    const token = await signToken({ key: trustedKey, claims });
    expect((await service().verify({ token })).aud).toEqual(claims.aud);
  });

  test('preserves environment and reusable workflow identity without interpreting the subject', async () => {
    const claims = {
      ...githubClaims(),
      sub: 'repo:acme/backend:repository_id:12345:environment:production',
      environment: 'production',
      job_workflow_ref: 'acme/automation/.github/workflows/release.yml@refs/tags/v1',
      job_workflow_sha: 'b'.repeat(SHA_LENGTH),
    };
    const token = await signToken({ key: trustedKey, claims });
    expect(await service().verify({ token })).toEqual(claims);
  });

  test('rejects an untrusted signature even when its key ID matches', async () => {
    const token = await signToken({ key: outsiderKey });
    await expect(service().verify({ token })).rejects.toBeInstanceOf(UnauthorizedError);
  });

  test('rejects tampered payloads', async () => {
    const token = await signToken({ key: trustedKey });
    const [header, , signature] = token.split('.');
    const payload = Buffer.from(
      JSON.stringify({ ...githubClaims(), repository: 'evil/repo' }),
    ).toString('base64url');
    await expect(
      service().verify({ token: `${header}.${payload}.${signature}` }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  test('rejects algorithms other than the GitHub RS256 algorithm', async () => {
    const key = await signingKey({ kid: 'rs384', algorithm: 'RS384' });
    const provider = new GitHubOidcProviderFixture([key.jwk]);
    const token = await signToken({ key });
    await expect(provider.service().verify({ token })).rejects.toBeInstanceOf(UnauthorizedError);
    expect(provider.requests).toBe(0);
  });

  test('does not use a token supplied signing-key URL or embedded key', async () => {
    const provider = new GitHubOidcProviderFixture([trustedKey.jwk]);
    const token = await signToken({
      key: outsiderKey,
      header: { jku: 'https://attacker.example/keys', jwk: outsiderKey.jwk },
    });
    await expect(provider.service().verify({ token })).rejects.toBeInstanceOf(UnauthorizedError);
    expect(provider.requests).toBe(1);
  });

  test.each(
    (
      [
        ['issuer', { iss: 'https://attacker.example' }],
        ['audience', { aud: 'https://other.example' }],
        ['expiry', { exp: 1 }],
        ['not before', { nbf: Math.floor(Date.now() / MS_PER_SECOND) + FUTURE_NOT_BEFORE_SECONDS }],
        [
          'future issue time',
          { iat: Math.floor(Date.now() / MS_PER_SECOND) + FUTURE_ISSUED_SECONDS },
        ],
        [
          'fractional timestamp',
          { iat: Math.floor(Date.now() / MS_PER_SECOND) - FRACTIONAL_SECOND },
        ],
        ['repository type', { repository: 123 }],
        ['repository format', { repository: 'backend' }],
        ['numeric repository ID', { repository_id: 12345 }],
        ['numeric run attempt', { run_attempt: 1 }],
        ['numeric-string timestamp', { iat: String(Math.floor(Date.now() / MS_PER_SECOND)) }],
        ['repository ID', { repository_id: 'not-an-id' }],
        ['repository owner ID', { repository_owner_id: 123 }],
        ['workflow type', { workflow_ref: [] }],
        ['ref', { ref: '' }],
        ['event', { event_name: '' }],
        ['commit SHA', { sha: 'not-a-sha' }],
        ['run ID', { run_id: '0' }],
        ['run attempt', { run_attempt: '0' }],
        ['environment', { environment: null }],
        ['reusable workflow identity', { job_workflow_ref: false }],
        ['reusable workflow SHA', { job_workflow_sha: 'invalid' }],
      ] as const
    ).map(([name, replacement]) => ({ name, replacement })),
  )('rejects invalid $name', async ({ replacement }) => {
    const token = await signToken({
      key: trustedKey,
      claims: { ...githubClaims(), ...replacement },
    });
    await expect(service().verify({ token })).rejects.toBeInstanceOf(UnauthorizedError);
  });

  test.each([
    'iss',
    'aud',
    'sub',
    'jti',
    'iat',
    'nbf',
    'exp',
    'repository',
    'repository_id',
    'repository_owner',
    'repository_owner_id',
    'workflow_ref',
    'ref',
    'event_name',
    'sha',
    'run_id',
    'run_attempt',
  ])('rejects a missing %s claim', async (claim) => {
    const claims: JWTPayload = githubClaims();
    delete claims[claim];
    const token = await signToken({ key: trustedKey, claims });
    await expect(service().verify({ token })).rejects.toBeInstanceOf(UnauthorizedError);
  });

  test.each(['', 'not-a-jwt', 'eyJhbGciOiJub25lIn0.e30.'])(
    'rejects malformed or unsigned tokens',
    async (token) => {
      await expect(service().verify({ token })).rejects.toThrow(
        'Invalid GitHub Actions identity token.',
      );
    },
  );
});
