import { APP_STATUS_LABELS } from '@repo/app-operations';
import { Badge } from '@repo/ui/components/badge';
import { Skeleton } from '@repo/ui/components/skeleton';
import { AppStateBadge } from '#components/apps/app-state-badge.tsx';
import { DeploymentStateBadge } from '#components/apps/deployment-state-badge.tsx';
import { useAppStatus } from '#lib/hooks/use-app-status.ts';
import type { AppSummary } from '#queries/apps.ts';

/**
 * What an app is doing, which is what its newest deployment is doing: an app row is `active`
 * from the moment it is created, so on its own it never says whether anything is serving.
 *
 * An app on its way out is the one case the row answers alone; every other answer needs the
 * release, including the two that say the host has not caught up with what the owner asked for
 * yet.
 */
export function AppStatusBadge({ app }: { app: AppSummary }) {
  const status = useAppStatus(app);

  if (status.isPending) {
    return <Skeleton className="h-5 w-20 rounded-2xl" />;
  }
  if (status.isError || status.status === undefined) {
    return <Badge variant="outline">unknown</Badge>;
  }

  switch (status.status.kind) {
    case 'app':
      return <AppStateBadge state={status.status.state} />;
    case 'deployment':
      return <DeploymentStateBadge state={status.status.state} />;
    case 'transition':
      return <Badge variant="outline">{status.status.label}</Badge>;
    case 'never-deployed':
      return <Badge variant="outline">{APP_STATUS_LABELS['never-deployed']}</Badge>;
  }
}
