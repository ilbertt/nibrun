import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { latestDeploymentQueryOptions } from '#queries/deployments.ts';

export function useLatestDeployment(appId: string): UseQueryResult<string, Error> {
  return useQuery(latestDeploymentQueryOptions(appId));
}
