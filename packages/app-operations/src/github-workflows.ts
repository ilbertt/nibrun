import type { PublicApiClient } from '@repo/api-client/public';
import { unwrap } from '@repo/api-client/unwrap';

const NOT_FOUND = 404;

type WorkflowRoutes = ReturnType<PublicApiClient['api']['apps']>['trusted-workflows'];
export type GitHubWorkflow = NonNullable<Awaited<ReturnType<WorkflowRoutes['get']>>['data']>;
export type GitHubWorkflowInput = Parameters<WorkflowRoutes['post']>[0];

export async function readGitHubWorkflow({
  api,
  appId,
}: {
  api: PublicApiClient;
  appId: string;
}): Promise<GitHubWorkflow | null> {
  const reply = await api.api.apps({ appId })['trusted-workflows'].get();
  if (reply.status === NOT_FOUND) {
    return null;
  }
  return unwrap(reply);
}

export async function setGitHubWorkflow({
  api,
  appId,
  workflowId,
  workflow,
}: {
  api: PublicApiClient;
  appId: string;
  workflowId: GitHubWorkflow['id'] | undefined;
  workflow: GitHubWorkflowInput;
}): Promise<GitHubWorkflow> {
  const routes = api.api.apps({ appId })['trusted-workflows'];
  return unwrap(
    workflowId === undefined
      ? await routes.post(workflow)
      : await routes({ workflowId }).put(workflow),
  );
}

export async function removeGitHubWorkflow({
  api,
  appId,
  workflowId,
}: {
  api: PublicApiClient;
  appId: string;
  workflowId: GitHubWorkflow['id'];
}): Promise<void> {
  unwrap(await api.api.apps({ appId })['trusted-workflows']({ workflowId }).delete());
}
