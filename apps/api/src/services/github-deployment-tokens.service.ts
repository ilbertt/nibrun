import type { AppId } from '@repo/protocol';
import { parseAccessTokenAuthorization } from 'better-auth/oauth2';
import type { DeploymentTokenResource } from '#lib/api/deployment-token.ts';
import type { Auth } from '#lib/auth/better-auth.ts';
import {
  DEPLOYMENT_TOKEN_PERMISSION,
  shortLivedDeploymentTokenConfiguration,
} from '#lib/auth/deployment-api-keys.ts';
import {
  DEPLOYMENT_TOKEN_LIFETIME_SECONDS,
  GITHUB_IDENTITY_TOKEN_MAX_LENGTH,
} from '#lib/deployment-grant-policy.ts';
import { UnauthorizedError } from '#lib/errors.ts';
import type { GitHubDeploymentGrantsServiceContract } from '#services/github-deployment-grants.service.ts';
import { Service } from '#services/service.ts';

const MS_PER_SECOND = 1000;
const ISSUANCE_MARGIN_SECONDS = 1;
export type IssueGitHubDeploymentTokenInput = { appId: AppId; headers: Headers };
export interface GitHubDeploymentTokensServiceContract {
  issue(input: IssueGitHubDeploymentTokenInput): Promise<DeploymentTokenResource>;
}

export class GitHubDeploymentTokensService
  extends Service
  implements GitHubDeploymentTokensServiceContract
{
  private readonly auth: Auth['api'];
  private readonly grantsService: GitHubDeploymentGrantsServiceContract;

  constructor({
    auth,
    grantsService,
  }: { auth: Auth['api']; grantsService: GitHubDeploymentGrantsServiceContract }) {
    super();
    this.auth = auth;
    this.grantsService = grantsService;
  }

  async issue({
    appId,
    headers,
  }: IssueGitHubDeploymentTokenInput): Promise<DeploymentTokenResource> {
    const identityToken = this.githubIdentityToken(headers);
    const grant = await this.grantsService.exchange({ appId, identityToken });
    const expiresIn =
      Math.min(
        DEPLOYMENT_TOKEN_LIFETIME_SECONDS,
        Math.floor((grant.expires_at.getTime() - Date.now()) / MS_PER_SECOND),
      ) - ISSUANCE_MARGIN_SECONDS;
    if (expiresIn <= 0) {
      throw new UnauthorizedError('The GitHub deployment grant has expired.');
    }
    const credential = await this.auth.createApiKey({
      body: {
        configId: shortLivedDeploymentTokenConfiguration.configId,
        userId: grant.owner_id,
        expiresIn,
        permissions: { [grant.app_id]: [DEPLOYMENT_TOKEN_PERMISSION] },
        metadata: { grantId: grant.id },
      },
    });
    if (!credential.expiresAt || credential.expiresAt.getTime() > grant.expires_at.getTime()) {
      throw new UnauthorizedError('The deployment token must expire within its grant lifetime.');
    }
    return { token: credential.key, expiresAt: credential.expiresAt.toISOString() };
  }

  private githubIdentityToken(headers: Headers): string {
    const authorization = parseAccessTokenAuthorization(headers.get('authorization'));
    if (
      authorization?.scheme !== 'Bearer' ||
      !authorization.token ||
      authorization.token.length > GITHUB_IDENTITY_TOKEN_MAX_LENGTH
    ) {
      throw new UnauthorizedError('A GitHub Actions OIDC Bearer token is required.');
    }
    return authorization.token;
  }
}
