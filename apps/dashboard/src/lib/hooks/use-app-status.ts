import { type AppStatus, appStatus, isSettling } from '@repo/app-operations';
import { useQuery } from '@tanstack/react-query';
import type { AppSummary } from '#queries/apps.ts';
import { type DeploymentSummary, deploymentsQueryOptions } from '#queries/deployments.ts';

/**
 * Nothing pushes a host's report to a browser, so a status that is waiting on one asks again.
 * Short enough to feel like the page is watching, and it stops the moment nothing is in motion.
 */
const SETTLING_POLL_MS = 2_000;

export type AppStatusResult = {
  /** Absent until there is an app and a release to read one from, which is what `isPending` says. */
  readonly status: AppStatus | undefined;
  readonly isPending: boolean;
  readonly isError: boolean;
};

/**
 * An app being deleted says everything about itself, so its releases are not read at all — the
 * query is skipped rather than asked and discarded.
 */
function readsDeployments(app: AppSummary): boolean {
  return app.state === 'active' || app.state === 'suspended';
}

function statusOf({
  app,
  deployments,
}: {
  app: AppSummary;
  deployments: DeploymentSummary[] | undefined;
}): AppStatus {
  return appStatus({ appState: app.state, deploymentState: deployments?.[0]?.state });
}

/**
 * Derived here rather than in `select`, so the one place the app and its releases are read
 * together is the one place they are put together — and `refetchInterval`, which is handed the
 * query and so the rows rather than what a caller sees, asks the same question the same way.
 */
export function useAppStatus(app: AppSummary | undefined): AppStatusResult {
  const deployments = useQuery({
    ...deploymentsQueryOptions(app && readsDeployments(app) ? app.id : undefined),
    refetchInterval: (query) =>
      app && isSettling(statusOf({ app, deployments: query.state.data }))
        ? SETTLING_POLL_MS
        : false,
  });

  // The skipped query never succeeds, so an app that answers alone is answered for here rather
  // than left waiting on a release nobody asked for.
  if (app && !readsDeployments(app)) {
    return { isPending: false, isError: false, status: statusOf({ app, deployments: undefined }) };
  }

  return {
    isPending: deployments.isPending,
    isError: deployments.isError,
    status:
      app && deployments.isSuccess ? statusOf({ app, deployments: deployments.data }) : undefined,
  };
}
