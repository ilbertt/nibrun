import type { AppId } from '@repo/protocol';
import { schema } from '#db/queries.gen.ts';
import type { DeploymentGrant } from '#lib/api/deployment-grant.ts';
import { DEPLOYMENT_GRANT_LIFETIME_MS } from '#lib/deployment-grant-policy.ts';
import {
  createDeploymentGrantToken,
  deploymentGrantTokenHash,
  deploymentGrantTokenOwner,
} from '#lib/deployment-grant-token.ts';
import { UnauthorizedError } from '#lib/errors.ts';
import type { GitHubActionsOidcClaims } from '#lib/github-actions-oidc.ts';
import { isUniqueViolation } from '#lib/pg-errors.ts';
import { toTimestamp } from '#lib/timestamp.ts';
import { matchesTrustedWorkflow } from '#lib/trusted-workflow.ts';
import type {
  GitHubDeploymentGrantRow,
  GitHubDeploymentGrantsRepositoryContract,
  GitHubWorkflowTrustRow,
} from '#repositories/github-deployment-grants.repository.ts';
import type { GitHubActionsOidcService } from '#services/github-actions-oidc.service.ts';
import { Service } from '#services/service.ts';

type GitHubActionsIdentityServiceContract = Pick<GitHubActionsOidcService, 'verify'>;
const TOKEN_ONCE_CONSTRAINT =
  schema.github_deployment_grants._indexes.github_deployment_grants_token_once_idx._indexName;
const INVALID_GRANT = 'Invalid or expired GitHub deployment grant.';
const UNTRUSTED_IDENTITY = 'GitHub identity is not authorized to deploy this app.';

export class GitHubDeploymentGrantsService extends Service {
  private readonly identityService: GitHubActionsIdentityServiceContract;
  private readonly grantsRepo: GitHubDeploymentGrantsRepositoryContract;

  constructor({
    identityService,
    grantsRepo,
  }: {
    identityService: GitHubActionsIdentityServiceContract;
    grantsRepo: GitHubDeploymentGrantsRepositoryContract;
  }) {
    super();
    this.identityService = identityService;
    this.grantsRepo = grantsRepo;
  }

  async exchange({
    appId,
    identityToken,
  }: {
    appId: AppId;
    identityToken: string;
  }): Promise<DeploymentGrant> {
    const identity = await this.identityService.verify({ token: identityToken });
    const trust = await this.authorizedTrust({ appId, identity });
    return this.issueGrant({ appId, identity, trust });
  }

  async authenticate({
    appId,
    token,
  }: {
    appId: AppId;
    token: string;
  }): Promise<GitHubDeploymentGrantRow> {
    const ownerId = this.tokenOwner(token);
    const grant = await this.grantsRepo.findValid({
      appId,
      ownerId,
      tokenHash: deploymentGrantTokenHash(token),
    });
    if (!grant) {
      throw new UnauthorizedError(INVALID_GRANT);
    }
    return grant;
  }

  private async authorizedTrust({
    appId,
    identity,
  }: {
    appId: AppId;
    identity: GitHubActionsOidcClaims;
  }): Promise<GitHubWorkflowTrustRow> {
    const trust = await this.grantsRepo.findTrust({
      appId,
      repository: identity.repository.toLowerCase(),
    });
    if (!trust || !matchesTrustedWorkflow({ workflow: trust, claims: identity })) {
      throw new UnauthorizedError(UNTRUSTED_IDENTITY);
    }
    return trust;
  }

  private async issueGrant({
    appId,
    identity,
    trust,
  }: {
    appId: AppId;
    identity: GitHubActionsOidcClaims;
    trust: GitHubWorkflowTrustRow;
  }): Promise<DeploymentGrant> {
    const token = createDeploymentGrantToken({ ownerId: trust.owner_id });
    const expiresAt = new Date(Date.now() + DEPLOYMENT_GRANT_LIFETIME_MS);
    const grant = await this.grantsRepo
      .create({
        appId,
        ownerId: trust.owner_id,
        trust,
        identity,
        tokenHash: deploymentGrantTokenHash(token),
        expiresAt,
      })
      .catch(function rejectReplay(error: unknown) {
        if (isUniqueViolation({ error, constraint: TOKEN_ONCE_CONSTRAINT })) {
          throw new UnauthorizedError(
            'GitHub identity token has already been exchanged for this app.',
          );
        }
        throw error;
      });
    if (!grant) {
      throw new UnauthorizedError(UNTRUSTED_IDENTITY);
    }
    return { id: grant.id, token, expiresAt: toTimestamp(grant.expires_at) };
  }

  private tokenOwner(token: string) {
    try {
      return deploymentGrantTokenOwner(token);
    } catch {
      throw new UnauthorizedError(INVALID_GRANT);
    }
  }
}
