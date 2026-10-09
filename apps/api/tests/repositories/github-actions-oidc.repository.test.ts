import { afterEach, beforeAll, describe, expect, setSystemTime, test } from 'bun:test';
import { UnauthorizedError } from '#lib/errors.ts';
import { GitHubActionsOidcRepository } from '#repositories/github-actions-oidc.repository.ts';
import { GitHubActionsOidcService } from '#services/github-actions-oidc.service.ts';
import {
  GitHubOidcProviderFixture,
  githubClaims,
  type SigningKey,
  signingKey,
  signToken,
} from '#tests/support/github-actions-oidc.ts';

const MS_PER_SECOND = 1000;

const AFTER_JWKS_REFRESH_COOLDOWN_MS = 31_000;

let originalKey: SigningKey;
let rotatedKey: SigningKey;

beforeAll(async () => {
  originalKey = await signingKey({ kid: 'original' });
  rotatedKey = await signingKey({ kid: 'rotated' });
});

afterEach(() => {
  setSystemTime();
});

describe('GitHub Actions signing keys', () => {
  test('rejects a token that expires while its signing key is being fetched', async () => {
    const claims = githubClaims();
    const repository = new GitHubActionsOidcRepository({
      fetch: function fetchJwks() {
        setSystemTime(claims.exp * MS_PER_SECOND);
        return Promise.resolve(Response.json({ keys: [originalKey.jwk] }));
      },
    });
    const service = new GitHubActionsOidcService(repository);
    const token = await signToken({ key: originalKey, claims });
    await expect(service.verify({ token })).rejects.toBeInstanceOf(UnauthorizedError);
  });

  test('caches keys across verifications without fetching on every request', async () => {
    const provider = new GitHubOidcProviderFixture([originalKey.jwk]);
    const service = provider.service();
    const token = await signToken({ key: originalKey });
    await service.verify({ token });
    await service.verify({ token });
    expect(provider.requests).toBe(1);
  });

  test('refreshes keys when GitHub rotates them after the refresh cooldown', async () => {
    const provider = new GitHubOidcProviderFixture([originalKey.jwk]);
    const service = new GitHubActionsOidcService(provider.repository());
    await service.verify({ token: await signToken({ key: originalKey }) });
    provider.keys = [rotatedKey.jwk];
    setSystemTime(Date.now() + AFTER_JWKS_REFRESH_COOLDOWN_MS);
    const token = await signToken({ key: rotatedKey });
    expect((await service.verify({ token })).repository).toBe('acme/backend');
    expect(provider.requests).toBe(2);
  });

  test('does not repeatedly fetch keys for attacker-selected unknown key IDs', async () => {
    const provider = new GitHubOidcProviderFixture([originalKey.jwk]);
    const service = provider.service();
    await service.verify({ token: await signToken({ key: originalKey }) });
    const token = await signToken({ key: rotatedKey });
    await expect(service.verify({ token })).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(service.verify({ token })).rejects.toBeInstanceOf(UnauthorizedError);
    expect(provider.requests).toBe(1);
  });

  test.each([
    new Response('unavailable', { status: 503 }),
    new Response('not-json', { status: 200 }),
    Response.json({ keys: [] }),
    Response.json({ keys: 'invalid' }),
  ])('fails closed when the signing key source cannot supply a usable key', async (response) => {
    const provider = new GitHubOidcProviderFixture([originalKey.jwk]);
    provider.response = response;
    const token = await signToken({ key: originalKey });
    await expect(provider.service().verify({ token })).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
