import type { AppId } from '@repo/protocol';
import type { Queries } from '#db/queries.gen.ts';
import type { DeploymentGrantId, OwnerId } from '#lib/api/identifiers.ts';
import type { GitHubActionsOidcClaims } from '#lib/github-actions-oidc.ts';
import { Repository } from '#repositories/repository.ts';

export type GitHubWorkflowTrustRow = Queries['SelectGitHubWorkflowTrust'];
export type GitHubDeploymentGrantRow = Queries['SelectValidGitHubDeploymentGrant'];
export type CreatedGitHubDeploymentGrantRow = Queries['InsertGitHubDeploymentGrant'];
export type CreateGitHubDeploymentGrantInput = {
  appId: AppId;
  ownerId: OwnerId;
  trust: GitHubWorkflowTrustRow;
  identity: GitHubActionsOidcClaims;
  expiresAt: Date;
};
export type FindGitHubWorkflowTrustInput = { appId: AppId; repository: string };
export type FindGitHubDeploymentGrantInput = {
  appId: AppId;
  ownerId: OwnerId;
  grantId: DeploymentGrantId;
};

export abstract class GitHubDeploymentGrantsRepositoryContract {
  abstract findTrust(input: FindGitHubWorkflowTrustInput): Promise<GitHubWorkflowTrustRow | null>;
  abstract create(
    input: CreateGitHubDeploymentGrantInput,
  ): Promise<CreatedGitHubDeploymentGrantRow | null>;
  abstract findValid(
    input: FindGitHubDeploymentGrantInput,
  ): Promise<GitHubDeploymentGrantRow | null>;
}

export class GitHubDeploymentGrantsRepository
  extends Repository
  implements GitHubDeploymentGrantsRepositoryContract
{
  async findTrust({
    appId,
    repository,
  }: FindGitHubWorkflowTrustInput): Promise<GitHubWorkflowTrustRow | null> {
    // CI has no account owner yet. Only a verified repository can resolve this authentication context.
    const [row] = await this.sql.SelectGitHubWorkflowTrust`
      SELECT w.id, w.current_revision, w.repository, w.workflow, w.environment, a.owner_id
      FROM nibrun.github_trusted_deployment_workflows w
      JOIN nibrun.live_apps a ON a.id = w.app_id
      WHERE w.app_id = ${appId} AND w.repository = ${repository} AND w.deleted_at IS NULL
    `;
    return row ?? null;
  }

  async create({
    appId,
    ownerId,
    trust,
    identity,
    expiresAt,
  }: CreateGitHubDeploymentGrantInput): Promise<CreatedGitHubDeploymentGrantRow | null> {
    const [row] = await this.sql.InsertGitHubDeploymentGrant`
      INSERT INTO nibrun.github_deployment_grants
        (app_id, owner_id, workflow_id, workflow_revision, expires_at,
         github_token_jti, github_repository, github_repository_id, github_repository_owner_id,
         github_workflow_ref, github_ref, github_event_name, github_commit_sha,
         github_run_id, github_run_attempt, github_environment,
         github_job_workflow_ref, github_job_workflow_sha)
      SELECT a.id, a.owner_id, w.id, w.current_revision, ${expiresAt},
        ${identity.jti}, ${identity.repository}, ${identity.repository_id}, ${identity.repository_owner_id},
        ${identity.workflow_ref}, ${identity.ref}, ${identity.event_name}, ${identity.sha},
        ${identity.run_id}, ${identity.run_attempt}, ${identity.environment ?? null},
        ${identity.job_workflow_ref ?? null}, ${identity.job_workflow_sha ?? null}
      FROM nibrun.live_apps a
      JOIN nibrun.github_trusted_deployment_workflows w ON w.app_id = a.id
      WHERE a.id = ${appId} AND a.owner_id = ${ownerId}
        AND w.id = ${trust.id} AND w.current_revision = ${trust.current_revision}
        AND w.deleted_at IS NULL
        AND to_timestamp(${identity.exp}) > statement_timestamp()
        AND ${expiresAt}::timestamptz > statement_timestamp()
      RETURNING id, app_id, owner_id, expires_at
    `;
    return row ?? null;
  }

  async findValid({
    appId,
    ownerId,
    grantId,
  }: FindGitHubDeploymentGrantInput): Promise<GitHubDeploymentGrantRow | null> {
    const [row] = await this.sql.SelectValidGitHubDeploymentGrant`
      SELECT g.id, g.app_id, g.owner_id, g.workflow_id, g.expires_at,
        g.github_token_jti, g.github_repository, g.github_repository_id, g.github_repository_owner_id,
        g.github_workflow_ref, g.github_ref, g.github_event_name, g.github_commit_sha,
        g.github_run_id, g.github_run_attempt, g.github_environment,
        g.github_job_workflow_ref, g.github_job_workflow_sha
      FROM nibrun.valid_github_deployment_grants g
      WHERE g.app_id = ${appId} AND g.owner_id = ${ownerId} AND g.id = ${grantId}
    `;
    return row ?? null;
  }
}
