import type { TrustedWorkflow } from '#lib/api/trusted-workflow.ts';
import type { GitHubActionsOidcClaims } from '#lib/github-actions-oidc.ts';

export function matchesTrustedWorkflow({
  workflow,
  claims,
}: {
  workflow: TrustedWorkflow;
  claims: Pick<
    GitHubActionsOidcClaims,
    'repository' | 'workflow_ref' | 'ref' | 'event_name' | 'environment'
  >;
}): boolean {
  if (claims.event_name !== 'push' && claims.event_name !== 'workflow_dispatch') {
    return false;
  }
  const repository = workflow.repository.toLowerCase();
  const ref = `refs/heads/${workflow.branch}`;
  const workflowPath = `/.github/workflows/${workflow.workflow}@${ref}`;
  return (
    claims.repository.toLowerCase() === repository &&
    claims.ref === ref &&
    claims.workflow_ref.slice(0, repository.length).toLowerCase() === repository &&
    claims.workflow_ref.slice(repository.length) === workflowPath &&
    (workflow.environment === null || claims.environment === workflow.environment)
  );
}
