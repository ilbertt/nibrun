import type { GitHubWorkflow } from '@repo/app-operations';
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { useSessionIdentity } from '#lib/hooks/use-session-identity.ts';
import { SessionIdentity } from '#lib/session-identity.ts';
import { githubWorkflowQueryOptions } from '#queries/github-workflow.ts';

export function useGitHubWorkflow(): UseQueryResult<GitHubWorkflow | null, Error> {
  return useQuery({
    ...githubWorkflowQueryOptions(useAppId()),
    enabled: useSessionIdentity() === SessionIdentity.WithAccount,
  });
}
