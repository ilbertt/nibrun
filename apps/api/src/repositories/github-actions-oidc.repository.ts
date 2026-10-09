import {
  createRemoteJWKSet,
  customFetch,
  type FetchImplementation,
  type FlattenedJWSInput,
  type JWSHeaderParameters,
} from 'jose';
import { GITHUB_ACTIONS_OIDC_JWKS_URL } from '#lib/github-actions-oidc.ts';

type SigningKeyInput = {
  protectedHeader: JWSHeaderParameters;
  token: FlattenedJWSInput;
};

export abstract class GitHubActionsOidcRepositoryContract {
  abstract signingKey(input: SigningKeyInput): Promise<CryptoKey>;
}

export class GitHubActionsOidcRepository implements GitHubActionsOidcRepositoryContract {
  private readonly keys: ReturnType<typeof createRemoteJWKSet>;

  constructor({ fetch = globalThis.fetch }: { fetch?: FetchImplementation } = {}) {
    this.keys = createRemoteJWKSet(new URL(GITHUB_ACTIONS_OIDC_JWKS_URL), {
      [customFetch]: fetch,
      timeoutDuration: 5_000,
    });
  }

  signingKey({ protectedHeader, token }: SigningKeyInput): Promise<CryptoKey> {
    return this.keys(protectedHeader, token);
  }
}
