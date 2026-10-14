import { readGitHubWorkflow } from '@repo/app-operations';
import { queryOptions } from '@tanstack/react-query';
import { api } from '#lib/api.ts';

export function githubWorkflowQueryOptions(appId: string) {
  return queryOptions({
    queryKey: ['github-workflow', appId],
    queryFn: () => readGitHubWorkflow({ api, appId }),
    retry: false,
  });
}
