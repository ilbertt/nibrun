import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { type DeploymentSummary, newestDeploymentQueryOptions } from '#queries/deployments.ts';

export function useNewestDeployment(appId: string): UseQueryResult<DeploymentSummary, Error> {
  return useQuery(newestDeploymentQueryOptions(appId));
}
