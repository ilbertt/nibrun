import { Value } from '@sinclair/typebox/value';
import { type FlattenedJWSInput, type JWSHeaderParameters, type JWTPayload, jwtVerify } from 'jose';
import { UnauthorizedError } from '#lib/errors.ts';
import {
  GITHUB_ACTIONS_OIDC_AUDIENCE,
  GITHUB_ACTIONS_OIDC_ISSUER,
  type GitHubActionsOidcClaims,
  GitHubActionsOidcClaimsSchema,
} from '#lib/github-actions-oidc.ts';
import type { GitHubActionsOidcRepositoryContract } from '#repositories/github-actions-oidc.repository.ts';
import { Service } from '#services/service.ts';

const MS_PER_SECOND = 1000;

export class GitHubActionsOidcService extends Service {
  private readonly repository: GitHubActionsOidcRepositoryContract;

  constructor(repository: GitHubActionsOidcRepositoryContract) {
    super();
    this.repository = repository;
  }

  async verify({ token }: { token: string }): Promise<GitHubActionsOidcClaims> {
    try {
      const claims = await this.verifyJwt({ token });
      this.validateGitHubClaims(claims);
      this.validateIssuedAt(claims.iat);
      return claims;
    } catch {
      throw new UnauthorizedError('Invalid GitHub Actions identity token.');
    }
  }

  private async verifyJwt({ token }: { token: string }): Promise<JWTPayload> {
    const repository = this.repository;
    const { payload: claims } = await jwtVerify(
      token,
      // biome-ignore lint/complexity/useMaxParams: jose passes the header and signed token separately.
      function signingKey(protectedHeader: JWSHeaderParameters, signedToken: FlattenedJWSInput) {
        return repository.signingKey({ protectedHeader, token: signedToken });
      },
      {
        issuer: GITHUB_ACTIONS_OIDC_ISSUER,
        audience: GITHUB_ACTIONS_OIDC_AUDIENCE,
        algorithms: ['RS256'],
        requiredClaims: GitHubActionsOidcClaimsSchema.required,
      },
    );
    return claims;
  }

  private validateGitHubClaims(claims: unknown): asserts claims is GitHubActionsOidcClaims {
    Value.Assert(GitHubActionsOidcClaimsSchema, claims);
  }

  private validateIssuedAt(issuedAt: number): void {
    const now = Math.floor(Date.now() / MS_PER_SECOND);
    if (issuedAt > now) {
      throw new UnauthorizedError('GitHub Actions identity token was issued in the future.');
    }
  }
}
