import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { type AppStatus, appStatus, isSettling } from '#lib/app-status.ts';
import type { AppSummary } from '#queries/apps.ts';
import { type DeploymentSummary, deploymentsQueryOptions } from '#queries/deployments.ts';

/**
 * Nothing pushes a host's report to a browser, so a status that is waiting on one asks again.
 * Short enough to feel like the page is watching, and it stops the moment nothing is in motion.
 */
const SETTLING_POLL_MS = 2_000;

/**
 * An app being deleted says everything about itself, so its releases are not read at all — the
 * query is skipped rather than asked and discarded.
 */
function readsDeployments(app: AppSummary): boolean {
  return app.state === 'active' || app.state === 'suspended';
}

export function useAppStatus(app: AppSummary): UseQueryResult<AppStatus, Error> {
  function statusOf(deployments: DeploymentSummary[] | undefined): AppStatus {
    return appStatus({ appState: app.state, deploymentState: deployments?.[0]?.state });
  }

  return useQuery({
    ...deploymentsQueryOptions(readsDeployments(app) ? app.id : undefined),
    select: statusOf,
    // The raw rows, not what `select` made of them: this is handed the query rather than the
    // value a caller sees.
    refetchInterval: (query) => (isSettling(statusOf(query.state.data)) ? SETTLING_POLL_MS : false),
  });
}
