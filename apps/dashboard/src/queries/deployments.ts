import { unwrap } from '@repo/api-client/unwrap';
import { latestDeployment } from '@repo/app-operations';
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

export function latestDeploymentQueryOptions(appId: string) {
  return queryOptions({
    queryKey: ['deployments', appId, 'latest'],
    queryFn: () => latestDeployment({ api, appId }),
  });
}
