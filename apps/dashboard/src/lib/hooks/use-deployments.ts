import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { type DeploymentSummary, deploymentsQueryOptions } from '#queries/deployments.ts';

export function useDeployments(
  appId: string | undefined,
): UseQueryResult<DeploymentSummary[], Error> {
  return useQuery(deploymentsQueryOptions(appId));
}
