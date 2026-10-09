import { AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { DeploymentGrantIdSchema, OwnerIdSchema } from '#lib/api/identifiers.ts';
import type { GitHubActionsOidcClaims } from '#lib/github-actions-oidc.ts';
import type {
  CreatedGitHubDeploymentGrantRow,
  CreateGitHubDeploymentGrantInput,
  FindGitHubDeploymentGrantInput,
  FindGitHubWorkflowTrustInput,
  GitHubDeploymentGrantRow,
  GitHubDeploymentGrantsRepositoryContract,
  GitHubWorkflowTrustRow,
} from '#repositories/github-deployment-grants.repository.ts';
import { trustedWorkflowResource } from '#tests/support/trusted-workflows.ts';

export const GRANT_APP_ID = Value.Parse(AppIdSchema, 'app-1');
export const GRANT_OWNER_ID = Value.Parse(OwnerIdSchema, 'owner-1');
export const GRANT_ID = Value.Parse(DeploymentGrantIdSchema, 'grant-1');

export class StubGitHubDeploymentGrantsRepository
  implements GitHubDeploymentGrantsRepositoryContract
{
  trust: GitHubWorkflowTrustRow | null = {
    ...trustedWorkflowResource(),
    owner_id: GRANT_OWNER_ID,
    current_revision: 'revision-1',
  };
  readonly lookups: FindGitHubWorkflowTrustInput[] = [];
  readonly writes: CreateGitHubDeploymentGrantInput[] = [];
  readonly authentications: FindGitHubDeploymentGrantInput[] = [];
  grant: GitHubDeploymentGrantRow | null = null;
  writable = true;

  findTrust(input: FindGitHubWorkflowTrustInput): Promise<GitHubWorkflowTrustRow | null> {
    this.lookups.push(input);
    return Promise.resolve(this.trust?.repository === input.repository ? this.trust : null);
  }

  create(input: CreateGitHubDeploymentGrantInput): Promise<CreatedGitHubDeploymentGrantRow | null> {
    this.writes.push(input);
    if (!this.writable) {
      return Promise.resolve(null);
    }
    this.grant = {
      id: GRANT_ID,
      app_id: input.appId,
      owner_id: input.ownerId,
      workflow_id: input.trust.id,
      ...githubGrantProvenance(input.identity),
      expires_at: input.expiresAt,
    };
    return Promise.resolve(this.grant);
  }

  findValid(input: FindGitHubDeploymentGrantInput): Promise<GitHubDeploymentGrantRow | null> {
    this.authentications.push(input);
    const write = this.writes.at(-1);
    const valid =
      write?.tokenHash === input.tokenHash &&
      this.grant?.app_id === input.appId &&
      this.grant?.owner_id === input.ownerId &&
      this.grant.expires_at.getTime() > Date.now();
    return Promise.resolve(valid ? this.grant : null);
  }
}

export function githubGrantProvenance(identity: GitHubActionsOidcClaims) {
  return {
    github_token_jti: identity.jti,
    github_repository: identity.repository,
    github_repository_id: identity.repository_id,
    github_repository_owner_id: identity.repository_owner_id,
    github_workflow_ref: identity.workflow_ref,
    github_ref: identity.ref,
    github_event_name: identity.event_name,
    github_commit_sha: identity.sha,
    github_run_id: identity.run_id,
    github_run_attempt: identity.run_attempt,
    github_environment: identity.environment ?? null,
    github_job_workflow_ref: identity.job_workflow_ref ?? null,
    github_job_workflow_sha: identity.job_workflow_sha ?? null,
  };
}
