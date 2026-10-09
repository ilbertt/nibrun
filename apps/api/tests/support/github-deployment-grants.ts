import { AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { DeploymentGrantIdSchema, OwnerIdSchema } from '#lib/api/identifiers.ts';
import type {
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
    revision: 'revision-1',
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

  create(input: CreateGitHubDeploymentGrantInput): Promise<GitHubDeploymentGrantRow | null> {
    this.writes.push(input);
    if (!this.writable) {
      return Promise.resolve(null);
    }
    this.grant = {
      id: GRANT_ID,
      app_id: input.appId,
      owner_id: input.ownerId,
      workflow_id: input.trust.id,
      identity: input.identity,
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
