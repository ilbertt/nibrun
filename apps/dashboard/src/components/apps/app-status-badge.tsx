import { AppStateBadge } from '#components/apps/app-state-badge.tsx';
import { DeploymentStateBadge } from '#components/apps/deployment-state-badge.tsx';
import { Badge } from '#components/ui/badge.tsx';
import { Skeleton } from '#components/ui/skeleton.tsx';
import { useDeployments } from '#lib/hooks/use-deployments.ts';
import type { AppSummary } from '#queries/apps.ts';

/**
 * What an app is doing, which is what its newest deployment is doing: an app row is `active`
 * from the moment it is created, so on its own it never says whether anything is serving.
 *
 * Its own state still wins when it is not `active` — an app being suspended or taken away is a
 * truer answer than whatever release it was left holding.
 */
export function AppStatusBadge({ app }: { app: AppSummary }) {
  const deployments = useDeployments(app.state === 'active' ? app.id : undefined);

  if (app.state !== 'active') {
    return <AppStateBadge state={app.state} />;
  }
  if (deployments.isPending) {
    return <Skeleton className="h-5 w-20 rounded-2xl" />;
  }
  if (deployments.isError) {
    return <Badge variant="outline">unknown</Badge>;
  }

  const latest = deployments.data[0];
  return latest === undefined ? (
    <Badge variant="outline">never deployed</Badge>
  ) : (
    <DeploymentStateBadge state={latest.state} />
  );
}
