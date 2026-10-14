import type { PublicApiClient } from '@repo/api-client/public';
import {
  type GitHubWorkflow,
  type GitHubWorkflowInput,
  setGitHubWorkflow,
} from '@repo/app-operations';
export type GitHubWorkflowFields = Omit<GitHubWorkflowInput, 'environment'> & {
  environment: string;
};

export function saveGitHubWorkflow({
  api,
  appId,
  workflowId,
  fields,
}: {
  api: PublicApiClient;
  appId: string;
  workflowId: GitHubWorkflow['id'] | undefined;
  fields: GitHubWorkflowFields;
}): Promise<GitHubWorkflow> {
  const workflow: GitHubWorkflowInput = {
    repository: fields.repository.trim(),
    workflow: fields.workflow.trim(),
    branch: fields.branch.trim(),
    environment: fields.environment.trim() || null,
  };
  return setGitHubWorkflow({ api, appId, workflowId, workflow });
}
