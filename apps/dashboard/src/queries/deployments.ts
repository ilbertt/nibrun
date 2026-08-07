import { unwrap } from '@repo/api-client/unwrap';
import { queryOptions, skipToken } from '@tanstack/react-query';
import { api } from '#lib/api.ts';

async function fetchDeployments(appId: string) {
  return unwrap(await api.api.apps({ appId }).deployments.get()).deployments;
}

export type DeploymentSummary = Awaited<ReturnType<typeof fetchDeployments>>[number];

export function deploymentsQueryOptions(appId: string | undefined) {
  return queryOptions({
    queryKey: ['deployments', appId],
    queryFn: appId === undefined ? skipToken : () => fetchDeployments(appId),
  });
}
