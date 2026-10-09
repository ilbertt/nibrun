import { expect } from 'bun:test';
import { exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
import {
  GITHUB_ACTIONS_OIDC_AUDIENCE,
  GITHUB_ACTIONS_OIDC_ISSUER,
  GITHUB_ACTIONS_OIDC_JWKS_URL,
  type GitHubActionsOidcClaims,
} from '#lib/github-actions-oidc.ts';
import { GitHubActionsOidcRepository } from '#repositories/github-actions-oidc.repository.ts';
import { GitHubActionsOidcService } from '#services/github-actions-oidc.service.ts';

const MS_PER_SECOND = 1000;
const TOKEN_LIFETIME_SECONDS = 300;
const NOT_BEFORE_OFFSET_SECONDS = 5;
const SHA_LENGTH = 40;

export async function signingKey({
  kid,
  algorithm = 'RS256',
}: {
  kid: string;
  algorithm?: string;
}) {
  const { privateKey, publicKey } = await generateKeyPair(algorithm, { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: algorithm, use: 'sig' };
  return { privateKey, jwk, kid, algorithm };
}

export type SigningKey = Awaited<ReturnType<typeof signingKey>>;

export function githubClaims(): GitHubActionsOidcClaims {
  const now = Math.floor(Date.now() / MS_PER_SECOND);
  return {
    iss: GITHUB_ACTIONS_OIDC_ISSUER,
    aud: GITHUB_ACTIONS_OIDC_AUDIENCE,
    sub: 'repo:acme/backend:ref:refs/heads/main',
    jti: 'test-token-id',
    iat: now,
    nbf: now - NOT_BEFORE_OFFSET_SECONDS,
    exp: now + TOKEN_LIFETIME_SECONDS,
    repository: 'acme/backend',
    repository_id: '12345',
    repository_owner: 'acme',
    repository_owner_id: '123',
    workflow_ref: 'acme/backend/.github/workflows/deploy.yml@refs/heads/main',
    ref: 'refs/heads/main',
    event_name: 'push',
    sha: 'a'.repeat(SHA_LENGTH),
    run_id: '123456',
    run_attempt: '1',
  };
}

export function signToken({
  key,
  claims = githubClaims(),
  header = {},
}: {
  key: SigningKey;
  claims?: Record<string, unknown>;
  header?: Record<string, unknown>;
}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: key.algorithm, kid: key.kid, ...header })
    .sign(key.privateKey);
}

export class GitHubOidcProviderFixture {
  keys: JWK[];
  requests = 0;
  response: Response | undefined;

  constructor(keys: JWK[]) {
    this.keys = keys;
  }

  repository() {
    const provider = this;
    return new GitHubActionsOidcRepository({
      fetch: function fetchJwks(url) {
        expect(url).toBe(GITHUB_ACTIONS_OIDC_JWKS_URL);
        provider.requests += 1;
        return Promise.resolve(provider.response ?? Response.json({ keys: provider.keys }));
      },
    });
  }

  service() {
    return new GitHubActionsOidcService(this.repository());
  }
}
