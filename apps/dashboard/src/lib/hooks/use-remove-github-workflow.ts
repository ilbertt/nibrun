import { type GitHubWorkflow, removeGitHubWorkflow } from '@repo/app-operations';
import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '#lib/api.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { githubWorkflowQueryOptions } from '#queries/github-workflow.ts';

export function useRemoveGitHubWorkflow(): UseMutationResult<void, Error, GitHubWorkflow['id']> {
  const appId = useAppId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (workflowId) => removeGitHubWorkflow({ api, appId, workflowId }),
    onSuccess: () => {
      queryClient.setQueryData(githubWorkflowQueryOptions(appId).queryKey, null);
    },
  });
}
