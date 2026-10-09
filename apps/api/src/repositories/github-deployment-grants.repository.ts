import type { AppId } from '@repo/protocol';
import type { Queries } from '#db/queries.gen.ts';
import type { OwnerId } from '#lib/api/identifiers.ts';
import type { GitHubActionsOidcClaims } from '#lib/github-actions-oidc.ts';
import { Repository } from '#repositories/repository.ts';

export type GitHubWorkflowTrustRow = Queries['SelectGitHubWorkflowTrust'];
export type GitHubDeploymentGrantRow = Queries['SelectValidGitHubDeploymentGrant'];
export type CreateGitHubDeploymentGrantInput = {
  appId: AppId;
  ownerId: OwnerId;
  trust: GitHubWorkflowTrustRow;
  identity: GitHubActionsOidcClaims;
  tokenHash: string;
  expiresAt: Date;
};
export type FindGitHubWorkflowTrustInput = { appId: AppId; repository: string };
export type FindGitHubDeploymentGrantInput = { appId: AppId; ownerId: OwnerId; tokenHash: string };

export abstract class GitHubDeploymentGrantsRepositoryContract {
  abstract findTrust(input: FindGitHubWorkflowTrustInput): Promise<GitHubWorkflowTrustRow | null>;
  abstract create(
    input: CreateGitHubDeploymentGrantInput,
  ): Promise<GitHubDeploymentGrantRow | null>;
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
      SELECT w.id, w.revision, w.repository, w.workflow, w.branch, w.environment, a.owner_id
      FROM nibrun.github_trusted_deployment_workflows w
      JOIN nibrun.live_apps a ON a.id = w.app_id
      WHERE w.app_id = ${appId} AND w.repository = ${repository}
    `;
    return row ?? null;
  }

  async create({
    appId,
    ownerId,
    trust,
    identity,
    tokenHash,
    expiresAt,
  }: CreateGitHubDeploymentGrantInput): Promise<GitHubDeploymentGrantRow | null> {
    const [row] = await this.sql.InsertGitHubDeploymentGrant`
      INSERT INTO nibrun.github_deployment_grants
        (app_id, owner_id, workflow_id, workflow_revision, identity, token_hash, expires_at)
      SELECT a.id, a.owner_id, w.id, w.revision, ${identity}::jsonb, ${tokenHash}, ${expiresAt}
      FROM nibrun.live_apps a
      JOIN nibrun.github_trusted_deployment_workflows w ON w.app_id = a.id
      WHERE a.id = ${appId} AND a.owner_id = ${ownerId}
        AND w.id = ${trust.id} AND w.revision = ${trust.revision}
        AND to_timestamp(${identity.exp}) > statement_timestamp()
        AND ${expiresAt}::timestamptz > statement_timestamp()
      RETURNING id, app_id, owner_id, workflow_id, identity, expires_at
    `;
    return row ?? null;
  }

  async findValid({
    appId,
    ownerId,
    tokenHash,
  }: FindGitHubDeploymentGrantInput): Promise<GitHubDeploymentGrantRow | null> {
    const [row] = await this.sql.SelectValidGitHubDeploymentGrant`
      SELECT g.id, g.app_id, g.owner_id, g.workflow_id, g.identity, g.expires_at
      FROM nibrun.github_deployment_grants g
      JOIN nibrun.live_apps a ON a.id = g.app_id AND a.owner_id = g.owner_id
      JOIN nibrun.github_trusted_deployment_workflows w
        ON w.id = g.workflow_id AND w.app_id = g.app_id AND w.revision = g.workflow_revision
      WHERE g.app_id = ${appId} AND g.owner_id = ${ownerId} AND g.token_hash = ${tokenHash}
        AND g.expires_at > statement_timestamp()
    `;
    return row ?? null;
  }
}
